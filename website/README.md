<div align="center">
  <img src="https://raw.githubusercontent.com/google/gemini-api-cookbook/main/assets/gemini-logo.png" alt="Gemini Logo" width="120" />
  <h1>Gemini Live App - Frontend UI 🎨</h1>
  <p><i>The interactive Next.js application featuring a smart multimedia whiteboard.</i></p>

  [![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](#)
  [![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](#)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](#)
</div>

---

## 📖 Overview

This directory houses the frontend Next.js application. It provides the user interface for the AI tutor, including the interactive whiteboard, tool palette (pen, eraser, select), continuous audio waveform visualizations, and handles user interactions (canvas snapshots, media capture) to send gracefully back to the `api` backend.

---

## 💻 Local Setup (Development)

Follow these steps to run the Next.js frontend on your local development machine.

### 1️⃣ Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed.
```bash
node -v
```

### 2️⃣ Installation
Navigate into the `website` directory and install the necessary npm packages:
```bash
cd website
npm install
```

### 3️⃣ Environment Variables
The frontend needs to know where your backend API is situated. Create a `.env.local` file:
```bash
touch .env.local
```
Add your local backend WebSocket URL:
```env
NEXT_PUBLIC_API_WS_URL="ws://localhost:8080"
```
*(Make sure the port matches the one defined in your backend's `.env`!)*

### 4️⃣ Start the Dev Server
Launch Next.js in development mode (which supports hot-reloading for rapid UI iteration):
```bash
npm run dev
```
> 🎉 **Success:** Open [http://localhost:3000](http://localhost:3000) in your browser to view the application!

---

## ☁️ Google Cloud Deployment

If you are transitioning to cloud deployment (e.g., using **Google Cloud Shell** or a **Compute Engine** instance), follow these steps.

### Step-by-Step

| Step | Action | Command/Details |
| :--- | :--- | :--- |
| **1.** | **Navigate** | `cd path/to/project/website` |
| **2.** | **Install** | `npm install` |
| **3.** | **Configure** | `nano .env.local`. Point `NEXT_PUBLIC_API_WS_URL` to your backend's public IP (e.g., `ws://34.123.45.67:8080`). Save: `Ctrl+O`, `Enter`, `Ctrl+X`. |

### Running the Production Server
Next.js projects run significantly faster when properly built for production.

```bash
# 1. Compile the optimized production build
npm run build

# 2. Start the production server
npm start
```
By default, the application will spin up on port **3000**.

### 🔒 Networking Notes
1. **VM Firewall:** If running on a standalone VM, ensure you edit your VPC firewall rules to allow **Ingress** on **tcp:3000**.
2. **Cloud Shell Preview:** If testing strictly inside Cloud Shell without exposing it to the web, you can use the built-in **Web Preview** button (top right of Cloud Shell) and map it to port `3000`.

---

<br>
<div align="center">
  <i>Crafted for the future of interactive AI education.</i>
</div>
