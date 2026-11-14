#!/usr/bin/env python3
"""A gentle music bed for a makaug film, made from scratch (no samples, no licence).

    python3 music.py --seconds 104 --out bed.wav [--key 0] [--bpm 96]

Warm pad chords (I-V-vi-IV), a soft bass, a marimba-like pattern and a light
shaker. It starts with the pad alone, fills in over the first bars, and ends on
the home chord with a fade. Quiet on purpose: it sits under the pictures.
"""
import argparse
import wave

import numpy as np

SR = 44100


def note(semitones_from_a4):
    return 440.0 * 2 ** (semitones_from_a4 / 12.0)


def env(n, attack, release):
    e = np.ones(n)
    a = min(n, int(attack * SR))
    r = min(n, int(release * SR))
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def pluck(freq, seconds, bright=0.55):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * freq * t) + bright * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 22) + 0.2 * np.sin(2 * np.pi * freq * 2 * t)
    return body * np.exp(-t * 6.5) * env(n, 0.004, 0.05)


def pad(freqs, seconds):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for detune in (-0.35, 0.0, 0.35):
            ff = f * (1 + detune / 100.0)
            out += np.sin(2 * np.pi * ff * t) + 0.3 * np.sin(2 * np.pi * 2 * ff * t) + 0.14 * np.sin(2 * np.pi * 3 * ff * t)
    return out / (len(freqs) * 3) * env(n, 0.55, 0.7)


def bass(freq, seconds):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(2 * np.pi * 2 * freq * t)) * np.exp(-t * 1.6) * env(n, 0.012, 0.12)


def kick(seconds=0.32):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    sweep = 46 + 70 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-t * 11)


def shaker(rng, seconds=0.07):
    n = int(seconds * SR)
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0.0)  # a crude high-pass
    return noise * np.exp(-np.arange(n) / SR * 60)


def reverb(x, rng, seconds=1.6, mix=0.22):
    n = int(seconds * SR)
    tail = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 4.2)
    tail[: int(0.012 * SR)] = 0
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(tail, size), size)[: len(x)]
    wet /= max(1e-9, np.max(np.abs(wet)))
    return (1 - mix) * x + mix * wet * np.max(np.abs(x))


def add(track, sound, at, gain=1.0):
    i = int(at * SR)
    if i >= len(track):
        return
    j = min(len(track), i + len(sound))
    track[i:j] += sound[: j - i] * gain


def build(seconds, bpm=96, key=0, seed=7):
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    bar = 4 * beat
    total = int(seconds * SR)
    left = np.zeros(total)
    right = np.zeros(total)
    # C major from A4: C4 = -9. Chords as semitone sets (root position, close voicing).
    chords = [(-9, -5, -2, 3), (-14, -10, -7, -2), (-12, -9, -5, 0), (-16, -12, -9, -4)]
    roots = [-21, -26, -24, -28]  # C3 G2 A2 F2: low, but a phone speaker can still play them
    arps = [(3, 7, 10, 15, 10, 7, 3, 7), (-2, 2, 5, 10, 5, 2, -2, 2), (0, 3, 7, 12, 7, 3, 0, 3), (-4, 0, 3, 8, 3, 0, -4, 0)]
    bars = int(np.ceil(seconds / bar)) + 1
    last_bar = max(1, int((seconds - 3.2) / bar))
    for b in range(bars):
        at = b * bar
        if at >= seconds:
            break
        ending = b >= last_bar
        c = 0 if ending else b % 4
        freqs = [note(s + key) for s in chords[c]]
        p = pad(freqs, bar * (2.2 if ending else 1.12))
        add(left, p, at, 0.26)
        add(right, np.roll(p, 180), at, 0.26)
        if b >= 1:
            add(left, bass(note(roots[c] + key), bar * 0.5), at, 0.24)
            add(right, bass(note(roots[c] + key), bar * 0.5), at, 0.24)
            if not ending:
                add(left, bass(note(roots[c] + key), beat), at + 2.5 * beat, 0.16)
                add(right, bass(note(roots[c] + key), beat), at + 2.5 * beat, 0.16)
        if b >= 2 and not ending:
            for i, s in enumerate(arps[c]):
                when = at + i * beat / 2
                sound = pluck(note(s + key), 0.9)
                pan = 0.35 + 0.3 * ((i % 4) / 3.0)
                velocity = 0.27 if i % 2 == 0 else 0.18
                add(left, sound, when, velocity * (1 - pan) * 2)
                add(right, sound, when, velocity * pan * 2)
        if b >= 4 and not ending:
            for i in range(8):
                when = at + i * beat / 2
                s = shaker(rng)
                g = 0.030 if i % 2 else 0.018
                add(left, s, when, g)
                add(right, s, when + 0.004, g)
            for k in (0, 2):
                kk = kick()
                add(left, kk, at + k * beat, 0.26)
                add(right, kk, at + k * beat, 0.26)
        if ending and b == last_bar:
            for i, s in enumerate((3, 7, 10, 15)):
                sound = pluck(note(s + key), 1.6)
                add(left, sound, at + i * beat / 2, 0.16)
                add(right, sound, at + i * beat / 2, 0.16)
    left = reverb(left, rng)
    right = reverb(right, np.random.default_rng(seed + 1))
    stereo = np.stack([left, right], axis=1)
    fade_in = int(0.4 * SR)
    fade_out = int(2.6 * SR)
    stereo[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    stereo[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None] ** 1.5
    peak = np.max(np.abs(stereo))
    stereo = np.tanh(stereo / peak * 1.15) / np.tanh(1.15)
    return stereo * 0.56  # about -5 dBFS at the loudest: a bed, not a song


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seconds', type=float, required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--bpm', type=float, default=96)
    ap.add_argument('--key', type=int, default=0)
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    audio = build(a.seconds, a.bpm, a.key, a.seed)
    pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2')
    with wave.open(a.out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    rms = float(np.sqrt(np.mean(audio ** 2)))
    print(f'{a.out}: {a.seconds:.1f}s, peak {20 * np.log10(np.max(np.abs(audio))):.1f} dBFS, rms {20 * np.log10(rms):.1f} dBFS')


if __name__ == '__main__':
    main()
