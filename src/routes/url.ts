import { Router } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { MediaProcessorService } from "../services/transcriber";
import { LinkedInService } from "../services/linkendinService";
import { GoogleDriveService } from "../services/googleDriveService";

const router = Router();
const TEMP_DIR = path.join(os.tmpdir(), "media-transcriber");

// Ensure temp directory exists
fs.mkdirSync(TEMP_DIR, { recursive: true });

router.post("/process", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  try {
    // Create a unique temp directory for this download
    const timestamp = Date.now();
    const sessionDir = path.join(TEMP_DIR, `session_${timestamp}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    console.log(`Processing URL: ${url}`);
    console.log(`Created session directory: ${sessionDir}`);

    let videoPath = "";

    if (LinkedInService.isLinkedInUrl(url)) {
      videoPath = await LinkedInService.downloadVideo(url);
    } else if (GoogleDriveService.isGoogleDriveUrl(url)) {
      videoPath = await GoogleDriveService.downloadFile(url);
    } else {
      return res.status(400).json({
        error:
          "Unsupported URL format. Please use LinkedIn or Google Drive URLs.",
      });
    }

    // Sanitize the filename - replace spaces and special characters
    const originalFilename = path.basename(videoPath);
    const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "");
    const newPath = path.join(sessionDir, safeFilename);

    try {
      // If the paths are different, move the file
      if (videoPath !== newPath) {
        fs.renameSync(videoPath, newPath);
      }
    } catch (e) {
      console.error(`Error moving file: ${e}`);
      try {
        fs.copyFileSync(videoPath, newPath);
        fs.unlinkSync(videoPath);
      } catch (copyError) {
        console.error(`Error during copy fallback: ${copyError}`);
        throw copyError;
      }
    }

    // Clean up original directory if it was a temporary download location
    const originalDir = path.dirname(videoPath);
    if (
      originalDir !== sessionDir &&
      originalDir !== TEMP_DIR &&
      fs.existsSync(originalDir)
    ) {
      try {
        if (fs.readdirSync(originalDir).length === 0) {
          fs.rmdirSync(originalDir);
        }
      } catch (e) {
        // Ignore directory removal errors
        console.error(`Error cleaning up directory: ${e}`);
      }
    }

    const mediaProcessor = new MediaProcessorService();
    const duration = await mediaProcessor.getAudioDuration(newPath);

    // Return the path relative to the project root for frontend use
    // We'll use a path that can be served via our static middleware
    const relativePath = `temp_resources/session_${timestamp}/${safeFilename}`;

    console.log(`Processed media file: ${relativePath}`);
    console.log(`Media duration: ${duration || "unknown"} seconds`);

    return res.json({
      success: true,
      filePath: relativePath,
      duration: duration ? Math.round(duration * 100) / 100 : null,
      filename: safeFilename,
    });
  } catch (error) {
    console.error(
      `Error processing URL: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(
      `Stack trace: ${
        error instanceof Error ? error.stack : "No stack trace available"
      }`
    );
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Unknown error during URL processing",
    });
  }
});

export { router as urlRoutes };
