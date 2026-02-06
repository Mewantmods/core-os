const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { session } = require("electron")
const os = require('os');
const { shell } = require('electron');

let win;
let windows = []
let isLoggedIn = false
const installFlag = path.join(app.getPath('userData'), 'installed.json');

ipcMain.on("login-success", () => {
    isLoggedIn = true
    windows.forEach(win => {
        win.webContents.send("unlock-session")
    })
})

ipcMain.handle("get-auth-state", () => {
    return isLoggedIn
})

function createWindows() {
    const displays = screen.getAllDisplays()

    displays.forEach(display => {
        const win = new BrowserWindow({
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height,
            fullscreen: true,
            resizable: false,
            movable: false,
            frame: false,
            transparent: true,
            hasShadow: true,
            backgroundColor: "#000",
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webviewTag: true,
            }
        })

        const coreOSHTML = path.join(__dirname, 'core', 'index.html')
        win.loadFile(coreOSHTML)

        windows.push(win)
    })
}

ipcMain.on('app-cross-display', (event, data) => {
    const { appId, state, direction } = data;

    // Get cursor position to find the target display
    const cursor = screen.getCursorScreenPoint();

    // Find the display the mouse is essentially pointing towards/inside
    // We add a buffer to ensure we pick the next screen, not the current one
    const point = { x: cursor.x, y: cursor.y };
    if (direction === 'right') point.x += 50;
    if (direction === 'left') point.x -= 50;
    if (direction === 'up') point.y -= 50;
    if (direction === 'down') point.y += 50;

    const targetDisplay = screen.getDisplayNearestPoint(point);

    // Find the browser window that belongs to this display
    // We match by checking if the window's bounds overlap with the display
    const targetWin = windows.find(w => {
        const bounds = w.getBounds();
        return bounds.x === targetDisplay.bounds.x && bounds.y === targetDisplay.bounds.y;
    });

    if (targetWin && targetWin.webContents.id !== event.sender.id) {
        // Send the app to the new window
        targetWin.webContents.send('incoming-app', {
            appId,
            state,
            // Reset position to the opposite edge
            edge: direction
        });

        // Tell the old window to close/hide the app
        event.sender.send('app-teleported-success', appId);
    }
});

app.whenReady().then(() => {
    session.defaultSession.on("will-download", (event, item) => {
        const savePath = path.join(app.getPath("downloads"), item.getFilename())
        item.setSavePath(savePath)

        item.on("updated", (_, state) => {
            if (state === "progressing") {
                const percent = item.getReceivedBytes() / item.getTotalBytes()
                // send progress to renderer if you want
            }
        })

        item.once("done", (_, state) => {
            if (state === "completed") {
                console.log("Downloaded:", savePath)
            }
        })
    })
})

app.whenReady().then(() => {
    if (fs.existsSync(installFlag)) {
        createWindows()
    } else {
        runInstaller()
    }
})

function runInstaller() {
    const win = new BrowserWindow({
        width: 1100,
        height: 700,
        resizable: false,
        frame: false,
        backgroundColor: "#000",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })

    win.loadFile(path.join(__dirname, 'installer', 'boot.html'))

    setTimeout(() => win.loadFile(path.join(__dirname, 'installer', 'logo.html')), 4000)
    setTimeout(() => win.loadFile(path.join(__dirname, 'installer', 'license.html')), 8000)

    setTimeout(() => {
        fs.writeFileSync(installFlag, JSON.stringify({ installed: true }))
        win.close()
        createWindows()
    }, 12000)
}

// --- FILE SYSTEM API ---


// 3. Create Folder
ipcMain.handle('fs-create-folder', async (event, folderPath) => {
    try {
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
            return { success: true };
        }
        return { error: "Folder already exists" };
    } catch (e) { return { error: e.message }; }
});

// 4. Create File
ipcMain.handle('fs-create-file', async (event, filePath, content = '') => {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, content);
            return { success: true };
        }
        return { error: "File already exists" };
    } catch (e) { return { error: e.message }; }
});

// 5. Delete File/Folder (Used for cleaning up if needed, though mostly we just delete shortcuts)
ipcMain.handle('fs-delete', async (event, targetPath) => {
    try {
        // Simple protection to prevent deleting root/home by accident
        if (targetPath === os.homedir() || targetPath === path.parse(process.cwd()).root) return { error: "Protected Path" };

        fs.rmSync(targetPath, { recursive: true, force: true });
        return { success: true };
    } catch (e) { return { error: e.message }; }
});

// 6. Get File Info (For Dragged Shortcuts)
ipcMain.handle('fs-get-info', async (event, filePath) => {
    try {
        const stats = fs.statSync(filePath);
        return {
            name: path.basename(filePath),
            isDirectory: stats.isDirectory(),
            path: filePath
        };
    } catch (e) { return null; }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("web-contents-created", (_, contents) => {
    contents.on("did-finish-load", () => {
        if (contents.getURL().endsWith("reboot.html")) {
            setTimeout(() => {
                win.loadFile("boot.html");
                setTimeout(() => win.loadFile("logo.html"), 3000);
                setTimeout(() => win.loadFile("index.html"), 6500);
            }, 3500);
        }
    });
});

// --- FILE SYSTEM & DOWNLOAD HANDLERS ---

// 1. Handle File System Requests
ipcMain.handle('fs-read-dir', async (event, dirPath) => {
    try {
        // VIRTUAL ROOT (shows drives)
        if (!dirPath || dirPath === "__ROOT__") {
            const drives = [];
            for (let i = 65; i <= 90; i++) {
                const drive = String.fromCharCode(i) + ":\\";
                if (fs.existsSync(drive)) {
                    drives.push({
                        name: drive,
                        isDirectory: true,
                        path: drive,
                        size: 0,
                        mtime: null
                    });
                }
            }
            return { path: "__ROOT__", files: drives };
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        const files = entries.map(entry => {
            const fullPath = path.join(dirPath, entry.name);
            let stats = {};
            try { stats = fs.statSync(fullPath); } catch { }

            return {
                name: entry.name,
                isDirectory: entry.isDirectory(),
                path: fullPath,
                size: stats.size || 0,
                mtime: stats.mtime || null
            };
        });

        files.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
            return a.isDirectory ? -1 : 1;
        });

        return { path: dirPath, files };
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle("fs-special-paths", () => {
    return {
        root: "__ROOT__",
        downloads: app.getPath("downloads"),
        documents: app.getPath("documents"),
        desktop: app.getPath("desktop")
    };
});

// 2. Open File (Launch in default OS app)
ipcMain.handle('fs-open', async (event, filePath) => {
    return shell.openPath(filePath);
});

// 3. Handle Downloads from the Browser App
// This intercepts any download triggered in the window (including iframes)
app.on('session-created', (session) => {
    session.on('will-download', (event, item, webContents) => {
        // Set default save path to user's Downloads folder
        const fileName = item.getFilename();
        const filePath = path.join(app.getPath('downloads'), fileName);

        item.setSavePath(filePath);

        item.once('done', (event, state) => {
            if (state === 'completed') {
                // Notify the renderer to show a success message
                windows.forEach(w => w.webContents.send('download-complete', { fileName, filePath }));
            }
        });
    });
});
