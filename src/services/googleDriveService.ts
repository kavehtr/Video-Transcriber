import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as os from "os";

export class GoogleDriveService {
  static isGoogleDriveUrl(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      return parsed.hostname.includes("drive.google.com");
    } catch (error) {
      return false;
    }
  }

  static getFileId(urlStr: string): string | null {
    try {
      if (urlStr.includes("/file/d/")) {
        // Handle links like: https://drive.google.com/file/d/{fileid}/view
        const fileId = urlStr.split("/file/d/")[1].split("/")[0];
        return fileId;
      } else if (urlStr.includes("id=")) {
        // Handle links like: https://drive.google.com/open?id={fileid}
        const parsed = new URL(urlStr);
        const params = new URLSearchParams(parsed.search);
        return params.get("id");
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  static async downloadFile(urlStr: string): Promise<string> {
    console.log("Downloading from Google Drive...");

    try {
      // Get file ID from URL
      const fileId = GoogleDriveService.getFileId(urlStr);
      if (!fileId) {
        throw new Error("Invalid Google Drive URL");
      }

      // Create temporary file with .mp4 extension
      const tempDir = path.join(os.tmpdir(), "media-transcriber");
      fs.mkdirSync(tempDir, { recursive: true });

      const output = path.join(tempDir, `${fileId}.mp4`);
      console.log(`Downloading file to: ${output}`);

      // Construct the download URL
      const downloadUrl = `https://drive.google.com/uc?id=${fileId}`;

      // Download the file with axios
      const response = await axios({
        method: "get",
        url: downloadUrl,
        responseType: "stream",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });

      // Save the file
      const writer = fs.createWriteStream(output);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          // Verify the download
          if (fs.statSync(output).size === 0) {
            reject(new Error("Downloaded file is empty"));
          } else {
            resolve(output);
          }
        });

        writer.on("error", (err) => {
          reject(err);
        });
      });
    } catch (error) {
      console.error(`\nError downloading from Google Drive: ${error}`);
      throw new Error(
        "Could not download from Google Drive. " +
          "Please ensure:\n" +
          "1. The file is publicly accessible (anyone with link can view)\n" +
          "2. The link is in format: drive.google.com/file/d/FILE_ID/view\n" +
          "3. The file is a video file (mp4 or webm)"
      );
    }
  }
}
