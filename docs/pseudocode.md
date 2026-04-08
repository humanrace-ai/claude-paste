# Pseudocode

## Main Paste Flow

```
FUNCTION handlePaste():
    clipText = await clipboard.readText()

    IF clipText is not empty:
        // Normal text on clipboard -- do standard paste
        executeCommand("workbench.action.terminal.paste")
        RETURN

    // Clipboard text empty -- likely an image
    result = await webviewBridge.readImage()

    IF NOT result.hasImage:
        // No image either -- fall through to normal paste
        executeCommand("workbench.action.terminal.paste")
        RETURN

    buffer = Buffer.from(result.base64, 'base64')

    IF buffer.length > config.maxImageSize:
        showWarning("Image too large")
        RETURN

    format = mimeTypeToFormat(result.mimeType)  // image/png -> png
    filePath = imageWriter.write(buffer, format)
    terminalInjector.inject(filePath)
    showInfo("Image saved: " + basename(filePath))
```

## Webview Clipboard Bridge

```
FUNCTION readImage() -> WebviewClipboardResult:
    panel = createWebviewPanel("Claude Paste")
    timeout = setTimeout(10s, () => resolve({ hasImage: false }))

    // Webview runs LOCALLY (renderer), tries auto-read first:
    TRY:
        items = await navigator.clipboard.read()
        FOR item IN items:
            IF item.type starts with "image/":
                blob = item.getType(type)
                base64 = blobToBase64(blob)
                postMessage({ type: "imageData", base64, mimeType })
                RETURN
        postMessage({ type: "noImage" })

    CATCH permissionError:
        // Auto-read blocked -- show paste-target UI
        showPasteZone()
        // User presses Cmd+V in the webview (user gesture = permissions)
        pasteZone.addEventListener("paste", (e) => {
            FOR item IN e.clipboardData.items:
                IF item.type starts with "image/":
                    blob = item.getAsFile()
                    base64 = blobToBase64(blob)
                    postMessage({ type: "imageData", base64, mimeType })
        })
```

## Image Writer

```
FUNCTION write(buffer: Buffer, format: string) -> string:
    dir = config.imageDir  // /tmp/claude-paste/images
    mkdirSync(dir, { recursive: true })

    filename = randomUUID() + "." + format
    filePath = join(dir, filename)

    writeFileSync(filePath, buffer)
    RETURN filePath
```

## Cleanup Daemon

```
FUNCTION startCleanup():
    setInterval(() => {
        files = readdir(config.imageDir)
        now = Date.now()

        FOR file IN files:
            stat = statSync(file)
            age = now - stat.mtimeMs

            IF age > config.imageTTL * 1000:
                unlinkSync(file)
                log("Cleaned up: " + file)
    }, 10 * 60 * 1000)  // every 10 minutes
```

## Terminal Injection

```
FUNCTION inject(filePath: string):
    terminal = window.activeTerminal

    IF NOT terminal:
        THROW "No active terminal"

    // Send path without newline -- user decides when to submit
    terminal.sendText(filePath, false)
```
