const express = require("express");
const morgan = require("morgan");
const multer = require("multer");
const cors = require("cors");
const {
  SendMessageCommand,
  SQSClient,
  CreateQueueCommand,
  GetQueueUrlCommand,
} = require("@aws-sdk/client-sqs");
const storage = multer.memoryStorage();

const app = express();

const client = new SQSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: "AKIAX74RUOGV4SDDR7W3",
    secretAccessKey: "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",
  },
});
app.use(cors())
app.use(express.json());
app.use(morgan("dev"));

app.post("/create", async (req, res) => {
  try {
    const command = new CreateQueueCommand({
      QueueName: "file-upload-test-queue",
    });

    const response = await client.send(command);

    return res.json(response);
  } catch (err) {
    console.log(err);
    return res.json({ message: err.message });
  }
});

app.post(
  "/upload-excel",
  multer({ storage: storage }).single("csv"),
  async (req, res) => {
    try {
      // Check if a file was uploaded
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const getQueueUrlCommand = new GetQueueUrlCommand({
        QueueName: "file-upload-test-queue",
      });
      const { QueueUrl } = await client.send(getQueueUrlCommand);

      console.log(QueueUrl);
      const sendMessagCommand = new SendMessageCommand({
        QueueUrl: QueueUrl,
        MessageBody: JSON.stringify({
          fileData: Buffer.from(req.file.buffer).toString("base64"),
        }),
      });
      const response = await client.send(sendMessagCommand);

      return res.json({ message: "Processing data" });
    } catch (error) {
      console.error("Error processing Excel file:", error);
      return res.status(500).json({ error: error, message: error.message });
    }
  }
);

const PORT = 8080;
app.listen(PORT, (err) => {
  if (err) {
    console.log(err);
  }
  console.log(`server running on port ${PORT}`);
});
