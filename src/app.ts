import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { transcribeRoute } from "./routes/transcribe";
import { urlRoutes } from "./routes/url";

const app = express();
const port = 3000;
const TEMP_DIR = path.join(os.tmpdir(), "media-transcriber");

// Ensure the temporary directory exists
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));
app.use("/resources", express.static(path.join(__dirname, "../resources")));
app.use("/temp_resources", express.static(TEMP_DIR));

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Use the routes
app.use("/api/transcribe", transcribeRoute);
app.use("/api/url", urlRoutes);

// Serve temp files from TEMP_DIR with better handling
app.get("/temp_resources/:sessionId/:filename", (req, res) => {
  const { sessionId, filename } = req.params;
  const filePath = path.join(TEMP_DIR, sessionId, filename);

  console.log(`Serving file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return res.status(404).send("File not found");
  }

  res.sendFile(filePath);
});

// Handle 404 errors
app.use((req, res) => {
  console.log(`404 Not Found: ${req.originalUrl}`);
  res.status(404).send("404 Not Found");
});

// Error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(`Error: ${err.message}`);
    console.error(err.stack);
    res.status(500).send("Something broke!");
  }
);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
