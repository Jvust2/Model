# Windows one-click launcher

## Goal

Normal use:

1. double-click `runtime/Model.cmd`;
2. choose `llama-server.exe` on first run;
3. the localhost Runtime starts;
4. the Model website opens;
5. connect Google Drive in the website;
6. choose a GGUF;
7. Runtime downloads it directly from Drive API into local cache;
8. llama.cpp starts;
9. chat on the same page.

Google Drive for desktop is not required.

## First run

Double-click:

    runtime\Model.cmd

The launcher asks for only:

- `llama-server.exe`

Saved config:

    %LOCALAPPDATA%\JvustModel\runtime.json

Default cache:

    %LOCALAPPDATA%\JvustModel\cache

Logs:

    %LOCALAPPDATA%\JvustModel\logs

No OAuth token is stored in runtime.json.

## Reset llama-server path

    runtime\Model.cmd -ResetConfig

## Force local website

    runtime\Model.cmd -LocalSite

## Do not open browser

    runtime\Model.cmd -NoBrowser

## Model download behavior

The browser sends the current short-lived Drive access token to localhost Runtime memory. When a GGUF is launched, Runtime downloads or resumes it from Google Drive API.

A complete local cache file is required before llama.cpp starts. This is a cache, not the canonical model store; Google Drive remains authoritative.
