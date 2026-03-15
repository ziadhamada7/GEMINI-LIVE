<div align="center">
  <img src="https://raw.githubusercontent.com/google/gemini-api-cookbook/main/assets/gemini-logo.png" alt="Gemini Logo" width="120" />
  <h1>Gemini Live API - Backend Engine 🚀</h1>
  <p><i>The core WebSocket & HTTP server powering real-time educational experiences.</i></p>

  [![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=nodedotjs&logoColor=white)](#)
  [![WebSocket](https://img.shields.io/badge/WebSocket-WS-010101?logo=socketdotio&logoColor=white)](#)
  [![Google Cloud](https://img.shields.io/badge/Google_Cloud-Ready-4285F4?logo=googlecloud&logoColor=white)](#)
</div>

---

## 📖 Overview

This directory contains the primary backend infrastructure for the application. It acts as the orchestrator connecting the frontend whiteboard UI to Google's Gemini Multimodal Live API via WebSockets, ensuring low-latency voice, video, and continuous context streaming.

---

## 💻 Local Setup (Development)

Follow these steps to run the backend engine on your local machine for testing and development.

### 1️⃣ Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine (v18 or higher recommended).
```bash
node -v
npm -v
```

### 2️⃣ Installation
Navigate into the `api` folder and install the required dependencies:
```bash
cd api
npm install
```

### 3️⃣ Configuration
Copy the sample environment file or create a new `.env` file in the root of the `api` directory:
```bash
# Create the .env file
touch .env
```
Add your **Gemini API Key** and development port:
```env
GEMINI_API_KEY="AIzaSyYourApiKeyGoesHere..."
PORT=8080
```

### 4️⃣ Start the Server
Run the local development server:
```bash
npm start
# or alternatively
node index.js
```
> 🎉 **Success:** You should see console output indicating the server is listening for WebSocket and HTTP connections on port `8080`.

---

## ☁️ Google Cloud Deployment

Deploying to **Google Cloud Compute Engine** or testing in **Cloud Shell** is straightforward.

### Preparation in Cloud Shell
1. Open [Google Cloud Console](https://console.cloud.google.com/) and click the **Activate Cloud Shell** icon (top right).
2. Clone your repository into the shell.
3. Node.js is pre-installed. Verify with `node -v` (Upgrade to v20 via `nvm install 20` if needed).

### Step-by-Step

| Step | Action | Command/Details |
| :--- | :--- | :--- |
| **1.** | **Navigate** | `cd path/to/project/api` |
| **2.** | **Install** | `npm install` |
| **3.** | **Configure** | `nano .env` (Add `GEMINI_API_KEY="..."` and `PORT=8080`, then save with `Ctrl+O` -> `Enter` -> `Ctrl+X`) |
| **4.** | **Run** | `node index.js` |

### 🔒 Firewall & Ports
If you are running this on a standalone **Compute Engine VM** rather than Cloud Run, you *must* ensure the VPC network allows incoming traffic to your port.
- Go to **VPC Network > Firewall**.
- Create a firewall rule allowing **Ingress** traffic on **tcp:8080** for your target instance tags.

### 🔄 Keep-Alive (Production)
For production instances, it's highly recommended to use a process manager like **PM2** to keep your backend running perpetually, even if your SSH session disconnects:
```bash
npm install -g pm2
pm2 start index.js --name "gemini-live-backend"
pm2 save
pm2 startup
```

---

<br>
<div align="center">
  <i>Built with ❤️ using the Gemini Multimodal Live API.</i>
</div>
