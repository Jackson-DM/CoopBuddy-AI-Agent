"""
Voice pipeline — push-to-talk → STT → TTS.

AudioCapture: Records mic while PTT key is held.
STT: Transcribes audio via faster-whisper (lazy-loaded).
TTS: ElevenLabs streaming with pyttsx3 fallback.
VoicePipeline: Wires PTT key → capture → STT, exposes TTS.speak().
"""

import asyncio
import io
import json
import logging
import os
import struct
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import sounddevice as sd
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Load settings ────────────────────────────────────────────────────────────

_SETTINGS_PATH = Path(__file__).resolve().parent.parent / "config" / "settings.json"
with open(_SETTINGS_PATH) as f:
    _SETTINGS = json.load(f)

_VOICE = _SETTINGS["voice"]
PTT_KEY = _SETTINGS["ptt_key"]
STT_MODEL = _VOICE["stt_model"]
MIN_RECORDING_SECS = _VOICE["min_recording_seconds"]
MIN_TRANSCRIPT_WORDS = _VOICE["min_transcript_words"]
STT_LOGPROB_THRESHOLD = _VOICE["stt_logprob_threshold"]
TTS_PROVIDER = _VOICE["tts_provider"]

SAMPLE_RATE = 16000
CHANNELS = 1


# ── Audio Capture ────────────────────────────────────────────────────────────

class AudioCapture:
    """Records microphone audio while PTT is held. Returns WAV bytes on release."""

    def __init__(self):
        self._frames: list[np.ndarray] = []
        self._stream: Optional[sd.InputStream] = None
        self._recording = False
        self._start_time = 0.0

    def start(self):
        """Begin recording from default microphone."""
        self._frames = []
        self._recording = True
        self._start_time = time.time()
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            callback=self._callback,
        )
        self._stream.start()
        logger.debug("Recording started")

    def stop(self) -> Optional[bytes]:
        """Stop recording. Returns WAV bytes, or None if too short."""
        self._recording = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

        duration = time.time() - self._start_time
        if duration < MIN_RECORDING_SECS:
            logger.debug(f"Recording too short ({duration:.2f}s), discarding")
            return None

        if not self._frames:
            return None

        audio = np.concatenate(self._frames)
        return self._to_wav(audio)

    def _callback(self, indata, frames, time_info, status):
        if status:
            logger.warning(f"Audio callback status: {status}")
        if self._recording:
            self._frames.append(indata.copy())

    @staticmethod
    def _to_wav(audio: np.ndarray) -> bytes:
        """Convert int16 numpy array to WAV bytes."""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)  # int16
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio.tobytes())
        return buf.getvalue()


# ── STT (Speech-to-Text) ────────────────────────────────────────────────────

class STT:
    """Transcribes audio using faster-whisper. Lazy-loads model on first use."""

    def __init__(self):
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            logger.info(f"Loading faster-whisper model '{STT_MODEL}' (first use)...")
            from faster_whisper import WhisperModel
            self._model = WhisperModel(STT_MODEL, device="cpu", compute_type="int8")
            logger.info("STT model loaded")

    async def transcribe(self, wav_bytes: bytes) -> Optional[str]:
        """Transcribe WAV bytes to text. Returns None if low quality or too short."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._transcribe_sync, wav_bytes)

    def _transcribe_sync(self, wav_bytes: bytes) -> Optional[str]:
        self._ensure_model()

        # Write to temp file (faster-whisper needs a file path)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes)
            tmp_path = tmp.name

        try:
            segments, info = self._model.transcribe(
                tmp_path,
                vad_filter=True,
                language="en",
            )

            texts = []
            for seg in segments:
                if seg.avg_logprob < STT_LOGPROB_THRESHOLD:
                    continue
                texts.append(seg.text.strip())

            transcript = " ".join(texts).strip()

            if len(transcript.split()) < MIN_TRANSCRIPT_WORDS:
                logger.debug(f"Transcript too short: '{transcript}'")
                return None

            logger.info(f"Transcribed: '{transcript}'")
            return transcript
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ── TTS (Text-to-Speech) ─────────────────────────────────────────────────────

class TTS:
    """Text-to-speech with ElevenLabs primary and pyttsx3 fallback."""

    def __init__(self):
        self._speak_lock = asyncio.Lock()
        self._provider = TTS_PROVIDER
        self._eleven_client = None
        self._pyttsx_engine = None

        # Check if ElevenLabs is available
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if self._provider == "elevenlabs" and not api_key:
            logger.warning("No ELEVENLABS_API_KEY — falling back to pyttsx3")
            self._provider = "pyttsx3"

    async def speak(self, text: str):
        """Speak text aloud. Prevents overlapping output."""
        if not text or self._provider == "none":
            return

        async with self._speak_lock:
            loop = asyncio.get_event_loop()
            try:
                if self._provider == "elevenlabs":
                    await loop.run_in_executor(None, self._speak_elevenlabs, text)
                else:
                    await loop.run_in_executor(None, self._speak_pyttsx3, text)
            except Exception as e:
                logger.error(f"TTS error ({self._provider}): {e}")
                # Try fallback if primary fails
                if self._provider == "elevenlabs":
                    logger.info("Falling back to pyttsx3")
                    try:
                        await loop.run_in_executor(None, self._speak_pyttsx3, text)
                    except Exception as e2:
                        logger.error(f"pyttsx3 fallback also failed: {e2}")

    def _speak_elevenlabs(self, text: str):
        if self._eleven_client is None:
            from elevenlabs.client import ElevenLabs
            self._eleven_client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))

        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # default: Rachel

        audio = self._eleven_client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id="eleven_turbo_v2_5",
            output_format="pcm_16000",
        )

        # Collect all chunks then play
        pcm_data = b"".join(audio)
        audio_array = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
        sd.play(audio_array, samplerate=16000)
        sd.wait()

    def _speak_pyttsx3(self, text: str):
        if self._pyttsx_engine is None:
            import pyttsx3
            self._pyttsx_engine = pyttsx3.init()
            self._pyttsx_engine.setProperty("rate", 175)

        self._pyttsx_engine.say(text)
        self._pyttsx_engine.runAndWait()


# ── Voice Pipeline ───────────────────────────────────────────────────────────

class VoicePipeline:
    """
    Wires PTT key → AudioCapture → STT.
    Exposes TTS.speak() for output.
    Callbacks for PTT start/stop (to suppress proactive brain events).
    """

    def __init__(
        self,
        on_transcript: Callable[[str], asyncio.Future],
        on_ptt_start: Optional[Callable[[], None]] = None,
        on_ptt_stop: Optional[Callable[[], None]] = None,
    ):
        self._on_transcript = on_transcript
        self._on_ptt_start = on_ptt_start
        self._on_ptt_stop = on_ptt_stop

        self._capture = AudioCapture()
        self.stt = STT()
        self.tts = TTS()

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ptt_held = False

    def start(self, loop: asyncio.AbstractEventLoop):
        """Start listening for PTT key. Must be called from the main thread."""
        import keyboard

        self._loop = loop

        keyboard.on_press_key(PTT_KEY, self._on_key_down, suppress=False)
        keyboard.on_release_key(PTT_KEY, self._on_key_up, suppress=False)
        logger.info(f"Voice pipeline ready — hold '{PTT_KEY}' to talk")

    def _on_key_down(self, event):
        if self._ptt_held:
            return
        self._ptt_held = True

        if self._on_ptt_start:
            self._on_ptt_start()

        self._capture.start()

    def _on_key_up(self, event):
        if not self._ptt_held:
            return
        self._ptt_held = False

        wav_bytes = self._capture.stop()

        if self._on_ptt_stop:
            self._on_ptt_stop()

        if wav_bytes and self._loop:
            asyncio.run_coroutine_threadsafe(self._process(wav_bytes), self._loop)

    async def _process(self, wav_bytes: bytes):
        """STT → callback with transcript."""
        transcript = await self.stt.transcribe(wav_bytes)
        if transcript:
            await self._on_transcript(transcript)
