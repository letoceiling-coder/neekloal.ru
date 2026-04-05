"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function runCmd(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(-2000)}`));
    });
  });
}

/**
 * Фолбэк без GPU: статичное изображение + zoompan (кинематографичное движение).
 */
async function ffmpegZoompanFromImage(imagePath, outMp4, durationSec = 6) {
  const vf = [
    "zoompan=z='min(zoom+0.0012,1.35)':d=",
    String(Math.round(25 * durationSec)),
    ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720",
  ].join("");
  await runCmd(FFMPEG, [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    vf,
    "-t",
    String(durationSec),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outMp4,
  ]);
}

/**
 * Склейка: видео + одна дорожка аудио (голос).
 */
async function mergeVideoVoice(videoPath, voiceMp3, outPath) {
  await runCmd(FFMPEG, [
    "-y",
    "-i",
    videoPath,
    "-i",
    voiceMp3,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    outPath,
  ]);
}

/**
 * Видео + голос + тихая музыка (sidechain / amix).
 */
async function mergeVideoVoiceMusic(videoPath, voiceMp3, musicMp3, outPath) {
  const filter = [
    "[1:a]volume=1[va]",
    "[2:a]volume=0.12[mu]",
    "[va][mu]amix=inputs=2:duration=first:dropout_transition=2[aout]",
  ].join(";");
  await runCmd(FFMPEG, [
    "-y",
    "-i",
    videoPath,
    "-i",
    voiceMp3,
    "-i",
    musicMp3,
    "-filter_complex",
    filter,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outPath,
  ]);
}

/**
 * Только замена/добавление аудио из одного mp3 (длина по короткой дорожке).
 */
async function mergeVideoSingleAudio(videoPath, audioPath, outPath) {
  await runCmd(FFMPEG, [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    outPath,
  ]);
}

/**
 * Motion smoothing via minterpolate (ffmpeg filter).
 */
async function interpolateVideo(inputPath, outputPath) {
  const vf = process.env.VIDEO_FFMPEG_MINTERPOLATE_VF
    || "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";
  await runCmd(FFMPEG, [
    "-y",
    "-i",
    inputPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    outputPath,
  ]);
}

/**
 * Lanczos 2x scale (optional quality step).
 */
async function upscaleVideo2x(inputPath, outputPath) {
  await runCmd(FFMPEG, [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale=iw*2:ih*2:flags=lanczos",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    outputPath,
  ]);
}

module.exports = {
  runCmd,
  ffmpeg: FFMPEG,
  ffmpegZoompanFromImage,
  mergeVideoVoice,
  mergeVideoVoiceMusic,
  mergeVideoSingleAudio,
  interpolateVideo,
  upscaleVideo2x,
};
