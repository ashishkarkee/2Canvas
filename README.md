# 2Canvas

This is a Chrome Extension I developed for community college students enrolled at multiple schools (like myself!), aggregating all Canvas LMS assignments due today into a single popup. Basically, it makes it easy to keep track of due dates across multiple schools :)

## Features

- Supports multiple Canvas accounts — each with its own URL and access token
- Pulls from the Canvas Calendar Events API and per-course Assignments API in parallel
- Deduplicates and sorts results by due time across all accounts
- Color-coded by college with course name, assignment title, and due time
- Highlights overdue assignments in red
- Click any assignment to open it directly in Canvas
- 30-minute cache with "Updated X mins ago" label for instant repeat opens
- Manual refresh button to force live data
- Form draft persistence — fields save across popup close/reopen
- Cache auto-invalidates at midnight and when accounts are added or removed

## Stack

- Manifest V3 Chrome Extension
- Vanilla JavaScript, HTML, CSS
- Canvas LMS REST API
- `chrome.storage.local`

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked** and select the `2Canvas/` folder
5. Pin the extension to your toolbar

## Adding a Canvas Account

1. Click the extension icon then **⚙**
2. Enter your college name, Canvas URL, and access token
3. Click **+ Add College**

Repeat for each college you are enrolled at.

## Generating a Canvas Access Token

1. Log in to Canvas at your college
2. Go to **Account → Settings → Approved Integrations**
3. Click **+ New Access Token**
4. Copy the token and paste it into the extension

> Keep your token private — it grants full access to your Canvas account.
<img width="575" height="687" alt="image" src="https://github.com/user-attachments/assets/671b3be1-3489-48c6-a2f5-e61f149d3925" />
<img width="567" height="702" alt="image" src="https://github.com/user-attachments/assets/0582236c-c649-4168-996d-785e96585fd1" />
