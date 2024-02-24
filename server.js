const express = require("express");
const morgan = require("morgan");
const multer = require("multer");
const cors = require("cors");
const io = require("socket.io-client");
const ExcelJS = require("exceljs");
const {
  SendMessageCommand,
  SQSClient,
  CreateQueueCommand,
  GetQueueUrlCommand,
  QueueDoesNotExist,
} = require("@aws-sdk/client-sqs");
const templateData = require("./look-up/data.json");

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, callback) => {
    if (!file.originalname.match(/\.(xlsx|xls)$/)) {
      return callback(new Error("Only Excel files are allowed"), false);
    }
    callback(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
}).single("csv");

const app = express();

const client = new SQSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: "AKIAX74RUOGV4SDDR7W3",
    secretAccessKey: "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",
  },
});

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const socketClient = io("http://localhost:5000");
socketClient.on("connect", () => {
  console.log("producer is connected to consumer");
});

async function getOrCreateQueue(queueName) {
  try {
    let queueUrl;

    try {
      const data = await client.send(
        new GetQueueUrlCommand({ QueueName: queueName })
      );
      queueUrl = data.QueueUrl;
      console.log("Queue already exists, URL:", queueUrl);
    } catch (err) {
      console.log(err.constructor.name);
      if (err instanceof QueueDoesNotExist) {
        const createData = await client.send(
          new CreateQueueCommand({ QueueName: queueName })
        );
        queueUrl = createData.QueueUrl;
        console.log("Queue created successfully, URL:", queueUrl);
      } else {
        throw err; // Re-throw other errors
      }
    }

    return queueUrl;
  } catch (err) {
    console.error("Error getting or creating queue:", err);
    throw err; // Re-throw to allow for further handling
  }
}

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

app.post("/upload-excel", upload, async (req, res) => {
  const { deviceid: deviceId } = req.headers;
  console.log(deviceId);
  try {
    // Check if a file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // TODO: if other file extension is uploaded, handle that case
    // TODO: handle file size scenario[should not be greater than 10 mb]
    // TODO: check if queue exists, if not then create a new queue->push message. Otherwise push message
    const getQueueUrlCommand = new GetQueueUrlCommand({
      QueueName: "file-upload-test-queue",
    });
    const QueueUrl = await getOrCreateQueue("file-upload-test-queue");

    const sendMessageCommand = new SendMessageCommand({
      QueueUrl: QueueUrl,
      MessageBody: JSON.stringify({
        fileData: Buffer.from(req.file.buffer).toString("base64"),
        deviceId: deviceId,
      }),
    });
    const response = await client.send(sendMessageCommand);
    socketClient.emit("receiveQueueMessage", "Message sent to queue");
    // socketClient.disconnect();

    return res.json({ message: "Processing data" });
  } catch (error) {
    console.error("Error: ", error);
    return res.status(500).json({ error: error, message: error.message });
  }
});

app.get("/generate-excel", async (_req, res) => {
  try {
    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();

    const instructionSheet = workbook.addWorksheet("Instructions");
    
    instructionSheet.mergeCells("A1:J6");
    // const mergedCell = (instructionSheet.getCell("A1:J6").value = {
    //   richText: [
    //     {
    //       font: { bold: true, italic: true },
    //       text: "Instruction for excel template",
    //     },
    //   ],excelmodifications
    // });
  //   let lastColumnIndex = 0;
  //   instructionSheet.eachRow({ includeEmpty: true }, function(row, rowNumber) {
  //     console.log("row number: ",rowNumber);
  //     row.eachCell({ includeEmpty: true },function(cell, colNumber) {
  //       // some code
  //       console.log("col number: ",colNumber);
  //       lastColumnIndex = Math.max(lastColumnIndex, colNumber)
  //   })
  //     //Do whatever you want to do with this row like inserting in db, etc
  // });
  // console.log(lastColumnIndex)
    console.log(instructionSheet.columnCount)
    for (let i = 10; i <= 1000; i++) {
      const column = instructionSheet.getColumn(i);
      column.hidden = true
    }

    const validationSheet = workbook.addWorksheet("Dropdown Sheet");


    validationSheet.columns = [
      {
        header: "Is Active",
        key: "is_active",
        width: 30
      }
    ]
    for(let i=2;i<=10;i++){
      validationSheet.getCell('A'+i).dataValidation ={
        type: 'list',
        allowBlank: true,
        formulae:['"Yes,No"'],
        errorTitle: 'Invalid value',
        error: 'Please select a value from the dropdown list (Yes or No)',
      }
    }

    // validationSheet.eachRow({ includeEmpty: true }, function(row, rowNumber) {
    //   console.log('Row ' + rowNumber + ' = ' + JSON.stringify(row.values));
    //   row.eachCell({ includeEmpty: true },function(cell, colNumber) {
    //     // some code
    //     console.log("col number: ",colNumber);
    // })
    // })

    for (const [key, value] of Object.entries(templateData)) {
      const worksheet = workbook.addWorksheet(key);
      const headers = value.map((v) => {
        return {
          header: v,
          key: v.split(" ").join("_").toLowerCase(),
          width: 30,
        };
      });
      // set headers for each sheet
      worksheet.columns = headers;
    }

    // Generate a buffer from the workbook
    const buffer = await workbook.xlsx.writeBuffer();

    // Create a multipart response
    res.set({
      "Content-Type": "multipart/mixed",
      "Content-Disposition": "attachment; filename=excel-template.xlsx",
    });

    // Send the buffer as a part of the multipart response
    res.write(buffer, "binary");
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = 8080;
app.listen(PORT, (err) => {
  if (err) {
    console.log(err);
  }
  console.log(`server running on port ${PORT}`);
});
