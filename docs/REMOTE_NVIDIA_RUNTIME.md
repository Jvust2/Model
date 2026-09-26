# Remote NVIDIA Runtime

## Goal

Allow a device without a usable NVIDIA CUDA GPU (for example an AMD-only Windows laptop) to keep using the same Model website and the same image/video task API while execution happens on another NVIDIA Windows machine.

The browser task contract does not change:

- `/v1/image/generate`
- `/v1/image/status`
- `/v1/image/file`
- `/v1/video/generate`
- `/v1/video/status`
- `/v1/video/file`
- Drive session and model-plan/cache APIs

Only the Runtime base URL changes.

## Network design

Remote mode uses **Tailscale Serve**, not Tailscale Funnel.

    Model website on client
          ↓ HTTPS inside tailnet
    https://<nvidia-node>.<tailnet>.ts.net
          ↓ Tailscale Serve
    http://127.0.0.1:8765
          ↓
    ModelRuntime.exe on NVIDIA Windows host
          ↓
    Drive API cache + llama.cpp / managed ComfyUI

The Runtime continues to bind only to `127.0.0.1`. No LAN/public listening socket is added.

Tailscale Serve is intended for services reachable inside a tailnet and remains subject to tailnet access-control policy. Do not replace the setup command with `tailscale funnel`; Funnel is public internet exposure and is outside this project's remote-runtime design.

Reference:

- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/reference/tailscale-cli/serve

## Authentication layers

Remote mode uses two layers:

1. Tailscale tailnet membership / ACL controls whether the remote HTTPS address can be reached.
2. Model Runtime uses a random 256-bit token for API calls.

`runtime/Enable-Remote-Nvidia.cmd` creates the Runtime token and stores it in the NVIDIA host's current-user Runtime config:

`%LOCALAPPDATA%\JvustModel\runtime.json`

The website stores the supplied Runtime token only in browser `sessionStorage`. It is intentionally not written to persistent `localStorage`.

The Runtime accepts the token through:

`Authorization: Bearer <token>`

and keeps compatibility with `X-Model-Runtime-Token`.

The unauthenticated `/health` endpoint returns only service/version/auth-required state. Protected API control/status endpoints require the token when remote auth is configured.

Generated media URLs are capability-style URLs using an unpredictable job ID and remain behind the tailnet + origin restrictions; task creation/status remains token-protected.

## Google Drive session

The browser still owns Google Drive login. When a model task is started, the current short-lived Drive OAuth access token is sent over the configured Runtime connection.

For remote mode this means:

    browser → tailnet HTTPS → remote NVIDIA Runtime

The Runtime keeps the Drive access token in memory only. It is not written into `runtime.json`, cache metadata, or logs.

Only configure a remote Runtime on a NVIDIA machine and tailnet that you control.

## Enable on the NVIDIA Windows host

Prerequisites:

- install the normal Model Runtime package;
- install and sign in to Tailscale;
- join the same tailnet as the client device;
- make sure the Runtime host has the NVIDIA driver/CUDA path required by the selected model.

Run:

    runtime\Enable-Remote-Nvidia.cmd

The script:

1. checks the installed Runtime config;
2. checks Tailscale and the node MagicDNS name;
3. creates/reuses a random Runtime token;
4. writes `remoteEnabled`, `remoteUrl`, `remoteMode` and `remoteToken` into the current-user Runtime config;
5. runs:

       tailscale serve --bg --yes http://127.0.0.1:8765

6. restarts the localhost Runtime so it receives `MODEL_REMOTE_TOKEN`;
7. prints the HTTPS Runtime URL and token.

Tailscale Serve background mode is persistent across Tailscale/device restarts according to the current Serve CLI behavior.

## Connect from the client device

On the client:

1. connect the client to the same tailnet;
2. open the Model website;
3. expand **高级诊断**;
4. set **Runtime Bridge** to the printed `https://...ts.net` URL;
5. enter the printed Runtime token;
6. click **重新连接**.

The Model web client rejects non-loopback remote `http://` URLs. Remote Runtime URLs must use HTTPS.

## Disable remote access

On the NVIDIA host run:

    runtime\Disable-Remote-Nvidia.cmd

This runs `tailscale serve off`, clears the saved remote token/URL state, and restarts Model Runtime in localhost-only unauthenticated mode.

## Rotate the Runtime token

From PowerShell in the extracted Runtime package:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File runtime\remote_nvidia.ps1 -RotateToken

After rotation, replace the token in the client browser and reconnect.

## State boundary

The repository contains the complete remote-routing/auth/setup implementation, but it is not considered end-to-end validated until it is exercised with:

- one client device without usable NVIDIA CUDA;
- one separate NVIDIA Windows host;
- both devices in the same tailnet;
- a real Drive model;
- a real image or video task;
- progress polling and media result return through the remote HTTPS Runtime.

Until that validation is recorded, project state should say **remote NVIDIA Runtime implemented / validation pending**, not fully validated.
