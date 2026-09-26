# Default Chat Bootstrap

## Purpose

Stage 3 of `MODEL_ENABLEMENT_PLAN.md` requires at least one real, small GGUF in Google Drive before the web chat path can be considered materially usable.

The bootstrap artifact is stored in Google Drive, not GitHub:

`AI-Model-Vault/notebook_launchers/启动_Qwen3-0.6B_Q8_0_DriveFirst.ipynb`

## Selected validation model

- Repository: `Qwen/Qwen3-0.6B-GGUF`
- File: `Qwen3-0.6B-Q8_0.gguf`
- Quantization: Q8_0
- Approximate download size: 639 MB
- License: Apache-2.0
- Official SHA256: `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`

This model is intentionally a bootstrap/validation model, not a replacement for the larger Qwen, DeepSeek, Coder, or writing models already listed in `model_metadata.json`.

## Drive target

The notebook writes the verified GGUF to:

`MyDrive/AI-Model-Vault/llm/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf`

It also writes `MODEL_READY.json` with the verified SHA256, size, GGUF version, tensor count, metadata count, and verification timestamp.

## Validation behavior

The notebook:

1. mounts Google Drive;
2. creates the canonical `llm/Qwen3-0.6B-GGUF` folder if needed;
3. reuses an already-correct file instead of downloading again;
4. downloads from the official Qwen Hugging Face repository;
5. validates SHA256;
6. reads the fixed 24-byte GGUF header and verifies `GGUF` magic;
7. writes the verification sidecar.

A mismatched existing file is deleted before a clean re-download.

## Website behavior

When a Drive scan has no runnable chat GGUF, the model library shows a bootstrap card instead of pretending a registered-but-missing chat model is usable.

The **准备默认聊天模型** action locates the notebook under the currently selected `AI-Model-Vault/notebook_launchers` folder and opens that exact Drive file in Colab.

After the notebook completes, the user rescans the vault. `assets/model-index.js` recognizes an unregistered `.gguf` under the explicit `llm` category as a llama.cpp chat package. The existing Runtime then handles Drive API download/resume, cache preflight, GGUF header validation, llama.cpp startup, and web chat.

## Invariants

- Google Drive remains canonical model storage.
- The model weight is never committed to GitHub.
- The bootstrap notebook does not change `model_metadata.json`.
- Presence of a `.gguf` outside a chat-like category does not imply llama.cpp chat compatibility.
- Larger registered chat models remain unavailable until their actual Drive weights exist.
