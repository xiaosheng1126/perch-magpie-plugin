# Perch AI Magpie & OpenCode Plugin

Magpie / OpenCode provider plugin for **Perch AI** models.

## ✨ Features

- **Keychain Auth Auto-Reuse**: Automatically detects and reads Perch CLI login credentials from macOS Keychain (`app.perchai.cli-auth`).
- **Silent Token Auto-Renewal**: Automatically detects access token expiration and silently exchanges fresh access tokens via Supabase Auth, updating macOS Keychain in-place.
- **Quota Meter**: Displays rolling quota status and plan information from `https://app.perchai.app/api/perchai/account`.
- **Free Model Indicators**: Registers all Perch AI models marked `· 免费`.
- **Protocol Adaptation**: Bridges standard OpenAI `/v1/chat/completions` requests to Perch's turn-ticket and model-call architecture.

## 📦 Installation in Magpie

```bash
magpie plugin add https://github.com/xiaosheng1126/perch-magpie-plugin
magpie plugin login perch
```

Or inspect quota:
```bash
magpie quota perch
```

## 📄 License

MIT
