import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export class LinkedInService {
  static isLinkedInUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const validPaths = [
        "/feed/update/urn:li:activity:", // Existing format
        "/posts/", // New format to support
      ];
      return (
        parsed.hostname.includes("linkedin.com") &&
        validPaths.some((path) => parsed.pathname.includes(path))
      );
    } catch {
      // If URL parsing fails, it's definitely not a valid LinkedIn URL
      return false;
    }
  }

  static async downloadVideo(url: string): Promise<string> {
    console.log(
      "Downloading LinkedIn video... 'cookies.txt' existence: " +
        fs.existsSync("cookies.txt")
    );

    // Create temporary directory for download
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-video-"));
    const outputTemplate = path.join(tempDir, "%(title)s.%(ext)s");

    try {
      // Download video using yt-dlp
      const ytdlpOptions = [
        "yt-dlp",
        `"${url}"`,
        "-f",
        "mp4",
        "-o",
        `"${outputTemplate}"`,
        "--quiet",
        "--no-warnings",
        "--progress",
      ].join(" ");

      await execPromise(ytdlpOptions);

      // Find the downloaded file
      const files = fs.readdirSync(tempDir);
      if (!files.length) {
        throw new Error("No file downloaded");
      }

      return path.join(tempDir, files[0]);
    } catch (error) {
      console.error(`Error downloading video: ${error}`);
      throw new Error(
        `Failed to download LinkedIn video: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
