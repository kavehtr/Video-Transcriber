import { OpenAI } from "openai";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";

const execPromise = promisify(exec);

export class MediaProcessorService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async runCommandWithOutput(cmd: string[], desc?: string): Promise<string> {
    if (desc) {
      console.log(`\n${desc}`);
    }

    const command = cmd.join(" ");
    const { stdout, stderr } = await execPromise(command);

    if (stderr) {
      console.error(stderr);
    }

    console.log(stdout);
    return stdout;
  }

  async getAudioDuration(filePath: string): Promise<number | null> {
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return null;
      }

      const cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ].join(" ");

      const { stdout, stderr } = await execPromise(cmd);

      if (stderr) {
        console.error(`Error executing ffprobe: ${stderr}`);
        return null;
      }

      return parseFloat(stdout.trim());
    } catch (error) {
      console.error("Error getting audio duration:", error);
      return null;
    }
  }

  async splitAudio(
    filePath: string,
    chunkSizeMb: number = 20
  ): Promise<string[]> {
    console.log("\nSplitting audio into chunks...");

    const MAX_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB in bytes
    const MAX_MEDIA_DURATION_SECONDS = 40 * 60; // 40 minutes
    const fileSize = fs.statSync(filePath).size;
    const duration = await this.getAudioDuration(filePath);

    if (!duration) {
      throw new Error("Could not determine audio duration");
    }

    if (duration > MAX_MEDIA_DURATION_SECONDS) {
      throw new Error(
        "Sorry, your video is too long. " +
          "To avoid extensive waiting times, " +
          "for this demo application we're only transcribing videos up to 40 minutes long"
      );
    }

    let chunkDuration = (duration * (chunkSizeMb * 1024 * 1024)) / fileSize;
    let numChunks = Math.ceil(duration / chunkDuration);
    const chunks: string[] = [];

    for (let currentChunk = 0; currentChunk < numChunks; currentChunk++) {
      const startTime = currentChunk * chunkDuration;
      const originalExt = path.extname(filePath);

      // Create a temporary file
      const tempDir = path.join(os.tmpdir(), "media-transcriber-chunks");
      fs.mkdirSync(tempDir, { recursive: true });
      const tempFilePath = path.join(
        tempDir,
        `chunk_${currentChunk}${originalExt}`
      );

      const cmd = [
        "ffmpeg",
        "-i",
        filePath,
        "-ss",
        startTime.toString(),
        "-t",
        chunkDuration.toString(),
        "-c",
        "copy",
        "-y",
        tempFilePath,
      ];

      await this.runCommandWithOutput(
        cmd,
        `Extracting chunk ${currentChunk + 1}/${numChunks}:`
      );

      // Give the file system a moment to complete writing
      await new Promise((resolve) => setTimeout(resolve, 500));

      const chunkSize = fs.statSync(tempFilePath).size;
      if (chunkSize > MAX_CHUNK_SIZE) {
        console.log(
          `Chunk ${currentChunk + 1} too large (${(
            chunkSize /
            1024 /
            1024
          ).toFixed(1)}MB), reducing duration...`
        );
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.error(`Warning: Could not delete oversized chunk: ${e}`);
        }
        chunkDuration *= 0.8;
        numChunks = Math.ceil(duration / chunkDuration);
        currentChunk--; // Retry this chunk with smaller duration
        continue;
      }

      chunks.push(tempFilePath);
    }

    return chunks;
  }

  async transcribe(filePath: string): Promise<string> {
    try {
      console.log("Opening file:", filePath);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileSize = fs.statSync(filePath).size;
      const MAX_SIZE = 25 * 1024 * 1024; // 25MB in bytes

      if (fileSize > MAX_SIZE) {
        console.log(
          `\nFile size (${(fileSize / 1024 / 1024).toFixed(
            2
          )}MB) exceeds API limit. Splitting into chunks...`
        );
        const chunks = await this.splitAudio(filePath);

        if (!chunks.length) {
          throw new Error("Failed to split audio file into chunks");
        }

        const fullTranscription: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunkPath = chunks[i];
          let maxRetries = 3;
          let retryCount = 0;

          while (retryCount < maxRetries) {
            try {
              console.log(
                `\nTranscribing chunk ${i + 1} of ${chunks.length}...`
              );
              const audioFile = fs.createReadStream(chunkPath);

              const transcript = await this.client.audio.transcriptions.create({
                model: "whisper-1",
                file: audioFile,
              });

              fullTranscription.push(transcript.text);
              break;
            } catch (error) {
              retryCount++;
              console.error(
                `Error on chunk ${i + 1} (attempt ${retryCount}): ${error}`
              );
              if (retryCount === maxRetries) {
                console.error(
                  `Failed to transcribe chunk ${
                    i + 1
                  } after ${maxRetries} attempts`
                );
                throw error;
              }
              console.log(`Retrying in 5 seconds...`);
              await new Promise((resolve) => setTimeout(resolve, 5000));
            }
          }

          try {
            fs.unlinkSync(chunkPath);
          } catch (e) {
            console.error(
              `Warning: Could not delete temporary file ${chunkPath}: ${e}`
            );
          }
        }

        return fullTranscription.join(" ");
      } else {
        console.log("Created read stream for file");
        const audioFile = fs.createReadStream(filePath);

        const transcript = await this.client.audio.transcriptions.create({
          model: "whisper-1",
          file: audioFile,
        });

        console.log("Received transcript from OpenAI");
        return transcript.text;
      }
    } catch (error) {
      console.error("Error in transcribe function:", error);
      throw new Error(
        `Transcription failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async cleanupTempFiles(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        if (fs.statSync(filePath).isFile()) {
          // Attempt to delete the file up to 5 times
          for (let i = 0; i < 5; i++) {
            try {
              fs.unlinkSync(filePath);
              break;
            } catch (e: any) {
              if (e.code === "EBUSY" || e.code === "EPERM") {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              } else {
                console.error(`Warning: Could not clean up ${filePath}: ${e}`);
                break;
              }
            }
          }
        } else if (fs.statSync(filePath).isDirectory()) {
          // Walk the directory from bottom up and delete files/folders
          const walkDir = (dir: string) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              const curPath = path.join(dir, file);
              if (fs.statSync(curPath).isDirectory()) {
                walkDir(curPath);
                try {
                  fs.rmdirSync(curPath);
                } catch (e) {
                  console.error(
                    `Warning: Could not clean up directory ${curPath}: ${e}`
                  );
                }
              } else {
                try {
                  fs.unlinkSync(curPath);
                } catch (e) {
                  console.error(
                    `Warning: Could not clean up file ${curPath}: ${e}`
                  );
                }
              }
            }
          };

          walkDir(filePath);
          try {
            fs.rmdirSync(filePath);
          } catch (e) {
            console.error(
              `Warning: Could not clean up directory ${filePath}: ${e}`
            );
          }
        }
      }
    } catch (e) {
      console.error(`Warning: Could not clean up ${filePath}: ${e}`);
    }
  }
}

// For backward compatibility with existing code
export async function transcribe(filePath: string): Promise<string> {
  const service = new MediaProcessorService();
  return service.transcribe(filePath);
}

export async function getAudioDuration(
  filePath: string
): Promise<number | null> {
  const service = new MediaProcessorService();
  return service.getAudioDuration(filePath);
}

// Add this if you want to run the file directly (for testing)
if (require.main === module) {
  // This section will run when the file is executed directly with node or ts-node
  const testTranscribe = async () => {
    try {
      const filePath = process.argv[2];
      if (!filePath) {
        console.error("Please provide a file path as an argument");
        process.exit(1);
      }

      const service = new MediaProcessorService();

      console.log(`Getting duration for ${filePath}...`);
      const duration = await service.getAudioDuration(filePath);
      console.log(`Duration: ${duration} seconds`);

      console.log(`Transcribing ${filePath}...`);
      const transcription = await service.transcribe(filePath);
      console.log("Transcription:");
      console.log(transcription);
    } catch (error) {
      console.error("Error:", error);
    }
  };

  testTranscribe();
}
