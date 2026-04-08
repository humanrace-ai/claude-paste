# Pseudocode

## Main Paste Flow

```
FUNCTION handlePaste():
    content = clipboardService.read()

    IF content.type == "text":
        // Let VSCode handle normal text paste
        executeCommand("workbench.action.terminal.paste")
        RETURN

    IF content.type == "image":
        IF content.size > config.maxImageSize:
            showError("Image too large")
            RETURN

        filePath = imageWriter.write(content.buffer, content.format)
        terminalInjector.inject(filePath)
        showInfo("Image pasted: " + basename(filePath))
```

## Clipboard Detection

```
FUNCTION read() -> ClipboardContent:
    // VSCode clipboard API only returns text
    text = await clipboard.readText()

    // Check if text is a base64-encoded image (from some clipboard managers)
    IF isBase64Image(text):
        buffer = decodeBase64(text)
        format = detectFormat(buffer)
        RETURN { type: "image", buffer, format, size: buffer.length }

    // Try native clipboard binary read
    IF platform == "darwin":
        buffer = exec("osascript -e 'clipboard info'")
        IF hasImageType(buffer):
            imageData = exec("osascript -e 'read clipboard as PNG'")
            RETURN { type: "image", buffer: imageData, format: "png", size: imageData.length }

    // For Remote-SSH: try reading from VSCode's data transfer API
    // Falls back to text paste
    RETURN { type: "text", text }
```

## Image Writer

```
FUNCTION write(buffer: Buffer, format: string) -> string:
    dir = resolveHome(config.imageDir)
    ensureDir(dir)

    filename = uuid() + "." + format
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
        showError("No active terminal")
        RETURN

    // Send path without newline -- user decides when to submit
    terminal.sendText(filePath, false)
```
