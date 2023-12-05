const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const { promisify } = require("util");
const writeFileAsync = promisify(fs.writeFile);
const cors = require("cors");
const app = express();

app.use(express.json());
app.use(cors());

const db_configuration = './config.json';
const rawdata = fs.readFileSync(db_configuration);
const config = JSON.parse(rawdata);

const mongodbUri = process.env.MONGODB_URI || config.mongodbUri;
mongoose.connect(mongodbUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB instance.");
});

const userSchema = new mongoose.Schema({
  name: String,
  repoLink: String,
  hasDockerfile: Boolean,
});

const User = mongoose.model("User", userSchema);

const hasDockerfile = async (name, repoLink) => {
  const checkDirectory = async (directory) => {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${name}/${repoLink}/contents/${directory}`
      );

      const files = response.data.filter((file) => file.type === "file");

      if (files.some((file) => file.name.toLowerCase() === "dockerfile")) {
        return true;
      }

      // Recursively check subdirectories
      const subdirectories = response.data.filter(
        (file) => file.type === "dir"
      );
      for (const subdirectory of subdirectories) {
        const subdirectoryHasDockerfile = await checkDirectory(
          `${directory}/${subdirectory.name}`
        );
        if (subdirectoryHasDockerfile) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error(
        `Error while checking directory ${directory} for Dockerfile:`,
        error
      );
      return false;
    }
  };

  return await checkDirectory("");
};

app.post("/api/users", async (req, res) => {
  console.log("Request Body:", req.body);

  const { name, repoLink } = req.body;

  try {
    const hasDockerfileResult = await hasDockerfile(name, repoLink);

    if (hasDockerfileResult) {
      const user = new User({ name, repoLink, hasDockerfile: true });
      await user.save();
      console.log("UsuarioGuardadoConExitoooo");
      res.status(201).json(user);
    } else {
      console.log("No Dockerfile found. User not saved.");
      res
        .status(400)
        .json({ message: "No Dockerfile found in the repository." });
    }
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ message: "Something went wrong while adding the user." });
  }
});

app.get("/api/users/:username/my-repos", async (req, res) => {
    const { username } = req.params;
  
    try {
      const user = await User.findOne({ name: username });
      
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }
  
      const repos = await User.find({ name: username }, { _id: 0, name: 1, repoLink: 1, hasDockerfile: 1 });
  
      res.status(200).json(repos);
    } catch (error) {
      console.error(`Error while fetching repositories for user ${username} from MongoDB:`, error);
      res.status(500).json({ message: `Something went wrong while fetching repositories for user ${username} from MongoDB.` });
    }
  });


// Get all repositories in general
app.get("/api/my-repos", async (req, res) => {
  try {
    const users = await User.find({}, { name: 1, repoLink: 1, _id: 0 });
    const repos = users.map((user) => ({
      name: user.name,
      repoLink: user.repoLink,
      hasDockerfile: user.hasDockerfile,
    }));

    res.status(200).json(repos);
  } catch (error) {
    console.error(
      "Error while fetching user repositories from MongoDB:",
      error
    );
    res
      .status(500)
      .json({
        message:
          "Something went wrong while fetching user repositories from MongoDB.",
      });
  }
});
// Download a selected repository
app.get("/api/repos/:username/:repoName/download", async (req, res) => {
    const { username, repoName } = req.params;
    const branchesToCheck = ["main", "master"];
  
    try {
      let downloadSuccessful = false;
      let zipFileName;
  
      for (const branch of branchesToCheck) {
        try {
          const response = await axios.get(`https://api.github.com/repos/${username}/${repoName}/zipball/${branch}`, {
            responseType: 'arraybuffer',
          });
  
          // Save the downloaded repository as a ZIP file
          zipFileName = `${repoName}_${branch}.zip`;
          await writeFileAsync(zipFileName, response.data);
  
          downloadSuccessful = true;
          break;  // Break the loop if the download is successful
        } catch (error) {
          // Continue to the next branch if the current branch fails
          console.error(`Error while downloading repository ${repoName} for user ${username} from branch ${branch}:`, error);
        }
      }
  
      if (!downloadSuccessful) {
        // If none of the branches succeeded, return a 404 response
        return res.status(404).json({ message: "Repository not found or download failed for all branches." });
      }
  
      // Send the ZIP file as a response
      res.download(zipFileName, zipFileName, (err) => {
        if (err) {
          console.error("Error while sending the ZIP file:", err);
          res.status(500).json({ message: "Error while sending the ZIP file." });
        } else {
          // Remove the saved ZIP file after sending
          fs.unlinkSync(zipFileName);
        }
      });
    } catch (error) {
      console.error(`Error while handling download request for repository ${repoName} for user ${username}:`, error);
      res.status(500).json({ message: `Something went wrong while handling download request for repository ${repoName} for user ${username}.` });
    }
  });


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
