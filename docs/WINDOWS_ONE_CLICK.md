# Windows one-click website launcher

## Goal

Normal use should feel like the Drive player:

1. double-click runtime/Model.cmd;
2. the local Runtime starts;
3. the Model website opens;
4. choose a Drive GGUF;
5. start the model;
6. chat on the same page.

## First run

Double-click runtime/Model.cmd.

The launcher asks for only two local paths:

- the Google Drive model root exposed by Google Drive for desktop;
- llama-server.exe.

The selected paths are saved outside the repository at:

    %LOCALAPPDATA%\JvustModel\runtime.json

No OAuth token, model weight, or Drive credential is stored in this config.

## Later runs

Double-click runtime/Model.cmd again.

The launcher validates the saved paths, starts runtime/local_bridge.py, waits for the bridge health check, opens the public Model site when reachable, and otherwise falls back to a local site on http://127.0.0.1:8000/.

## Change paths

Run:

    runtime\Model.cmd -ResetConfig

## Force local website

Run:

    runtime\Model.cmd -LocalSite

## Do not open a browser automatically

Run:

    runtime\Model.cmd -NoBrowser

## Current limitation

The website itself can be public, but llama.cpp still needs the local Runtime because a normal browser page cannot directly spawn native Windows inference or give llama.cpp a normal seekable Google Drive file path.
