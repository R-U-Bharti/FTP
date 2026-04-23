import { useState, useRef, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import LocaldropServer from "./modules/localdrop-server";
import { io, Socket } from "socket.io-client";

export default function App() {
  const [pcIp, setPcIp] = useState("");
  const [connected, setConnected] = useState(false);
  const [sharedDirUri, setSharedDirUri] = useState<string | null>(null);
  const [sharedDirName, setSharedDirName] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const sharedDirUriRef = useRef<string | null>(null);
  const cancelledDownloads = useRef<Set<string>>(new Set());
  
  // Start native HTTP server
  useEffect(() => {
    LocaldropServer.startServer(8080).catch(err => {
      console.log("Failed to start native HTTP server: " + err.message);
    });
    return () => {
      LocaldropServer.stopServer();
    };
  }, []);
  
  // Concurrency control for downloads/previews
  const activeTasks = useRef(0);
  const taskQueue = useRef<(() => Promise<void>)[]>([]);

  const processQueue = useCallback(async () => {
    if (activeTasks.current >= 3 || taskQueue.current.length === 0) return;
    
    activeTasks.current++;
    const task = taskQueue.current.shift();
    if (task) {
      try {
        await task();
      } catch (e) {
        console.error("Queue task error:", e);
      }
    }
    activeTasks.current--;
    processQueue();
  }, []);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg].slice(-10));
    console.log(msg);
  };

  const connectToPc = () => {
    if (!pcIp) {
      Alert.alert("Error", "Please enter PC IP address");
      return;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const url = `http://${pcIp}:3001`;
    addLog(`Pinging ${url}/api/health...`);

    // First test raw HTTP connection
    fetch(`${url}/api/health`, { method: "GET" })
      .then(res => res.json())
      .then(data => {
        addLog(`HTTP Ping success: ${data.status}`);
        addLog(`Now starting WebSocket...`);

        const socket = io(url, {
          transports: ["polling", "websocket"], // Try polling first for React Native
          forceNew: true,
          query: { clientType: "expo-app" },
        });

        socket.on("connect", () => {
          setConnected(true);
          addLog("Connected to PC!");
        });

        socket.on("disconnect", () => {
          setConnected(false);
          addLog("Disconnected from PC.");
        });

        socket.on("connect_error", err => {
          addLog(`Socket error: ${err.message}`);
        });

        // Handle file list requests from PC
        socket.on(
          "file:list_request",
          async (data: { path: string; requestId: string }) => {
            if (!sharedDirUri) {
              socket.emit("file:list_response", {
                requestId: data.requestId,
                error: "No directory shared on mobile",
              });
              return;
            }

            try {
              const currentDir = sharedDirUriRef.current;
              const targetUri =
                data.path === "." || !data.path ? currentDir : data.path;
                
              if (!targetUri) {
                addLog(`No folder selected!`);
                socket.emit("file:list_response", {
                  requestId: data.requestId,
                  entries: [],
                  error: "No folder shared on mobile app"
                });
                return;
              }

              addLog(
                `PC requested file list for ${data.path === "." ? "root" : "subfolder"}`,
              );

              const isSAF = targetUri.startsWith("content://");
              let files: string[] = [];
              
              if (isSAF) {
                files = await FileSystem.StorageAccessFramework.readDirectoryAsync(targetUri);
              } else {
                // For file:// URIs (Internal Storage / Root)
                const fileNames = await FileSystem.readDirectoryAsync(targetUri);
                // Convert names to full file:// URIs
                const baseUri = targetUri.endsWith('/') ? targetUri : targetUri + '/';
                files = fileNames.map(name => baseUri + name);
              }
              
              addLog(`Found ${files.length} items in folder`);

              const knownFileExts = new Set([
                "jpg",
                "jpeg",
                "png",
                "gif",
                "webp",
                "bmp",
                "svg",
                "heic",
                "heif",
                "mp4",
                "mkv",
                "avi",
                "mov",
                "webm",
                "3gp",
                "flv",
                "mp3",
                "wav",
                "flac",
                "ogg",
                "aac",
                "m4a",
                "pdf",
                "doc",
                "docx",
                "xls",
                "xlsx",
                "ppt",
                "pptx",
                "txt",
                "rtf",
                "csv",
                "zip",
                "rar",
                "7z",
                "tar",
                "gz",
                "apk",
                "iso",
                "js",
                "ts",
                "json",
                "html",
                "css",
                "xml",
                "log",
                "md",
              ]);

              const entries = files.map(fileUri => {
                const decodedUri = decodeURIComponent(fileUri).replace(
                  /%2F/g,
                  "/",
                );
                const name = decodedUri.split("/").pop() || "Unknown";

                const parts = name.split(".");
                const ext = parts.length > 1 ? parts.pop()?.toLowerCase() : "";

                // If it has a known extension, or it has an extension and doesn't start with a dot
                const isFile = ext
                  ? knownFileExts.has(ext) ||
                    (parts[0] !== "" && ext.length <= 4)
                  : false;

                return {
                  name,
                  path: fileUri,
                  isDirectory: !isFile,
                  size: 0,
                  modifiedAt: new Date().toISOString(),
                };
              });

              socket.emit("file:list_progress", {
                requestId: data.requestId,
                loaded: entries.length,
                total: entries.length,
                partialEntries: entries,
              });

              addLog(`Sending ${entries.length} fast readable entries back`);
              socket.emit("file:list_response", {
                requestId: data.requestId,
                entries,
              });
            } catch (err) {
              addLog(`Read dir error: ${err}`);
              socket.emit("file:list_response", {
                requestId: data.requestId,
                error: String(err),
              });
            }
          },
        );

        // Handle file download request from PC
        socket.on(
          "file:download_request",
          async (data: {
            path: string;
            requestId: string;
            isPreview?: boolean;
          }) => {
            const task = async () => {
              try {
                addLog(`PC downloading file...`);
                let fileUri = data.path;

                const info = await FileSystem.getInfoAsync(fileUri);
                if (!info.exists) throw new Error("File does not exist");

                if (data.isPreview) {
                  let tempUri = null;
                  try {
                    let manipUri = fileUri;
                    if (fileUri.startsWith('content://')) {
                      tempUri = FileSystem.cacheDirectory + 'temp_preview_' + Math.random().toString(36).substring(7) + '.jpg';
                      await FileSystem.copyAsync({ from: fileUri, to: tempUri });
                      manipUri = tempUri;
                    }

                    const manipResult = await ImageManipulator.manipulateAsync(
                      manipUri,
                      [{ resize: { width: 150 } }],
                      { compress: 0.3, format: ImageManipulator.SaveFormat.JPEG },
                    );
                    fileUri = manipResult.uri;

                    if (tempUri) FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
                  } catch (e) {
                    addLog(`Preview generation failed: ${e}`);
                    if (tempUri) FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
                  }
                }

                const newInfo = await FileSystem.getInfoAsync(fileUri);
                const totalSize = newInfo.size || 0;
                const chunkSize = 1024 * 1024 * 1; // 1MB chunks to avoid JS bridge bottlenecks
                let position = 0;

                while (position < totalSize) {
                  if (cancelledDownloads.current.has(data.requestId)) {
                    addLog(`Download cancelled by PC`);
                    socket.emit('file:download_response', { requestId: data.requestId, error: 'Cancelled by user' });
                    cancelledDownloads.current.delete(data.requestId);
                    return; // break out of task
                  }
                  const chunkLength = Math.min(chunkSize, totalSize - position);
                const chunkData = await FileSystem.readAsStringAsync(fileUri, {
                  encoding: FileSystem.EncodingType.Base64,
                  position,
                  length: chunkLength,
                });

                socket.emit("file:download_chunk", {
                  requestId: data.requestId,
                  chunk: chunkData,
                  position,
                  totalSize,
                });

                position += chunkLength;
              }

              socket.emit("file:download_response", {
                requestId: data.requestId,
              });
              addLog(`Sent file to PC!`);
            } catch (err) {
              socket.emit("file:download_response", {
                requestId: data.requestId,
                error: String(err),
              });
              addLog(`Failed to send: ${err}`);
            }
          };
          taskQueue.current.push(task);
          processQueue();
        });

      socket.on("file:download_cancel", (data: { requestId: string }) => {
        cancelledDownloads.current.add(data.requestId);
      });

      socketRef.current = socket;
      })
      .catch(err => {
        addLog(`HTTP Ping failed! Is PC firewall blocking?`);
        addLog(`Error: ${err.message}`);
      });
  };

  const selectFolder = async () => {
    try {
      if (FileSystem.StorageAccessFramework) {
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          setSharedDirUri(permissions.directoryUri);
          sharedDirUriRef.current = permissions.directoryUri;
          const decoded = decodeURIComponent(permissions.directoryUri);
          setSharedDirName(decoded.split(":").pop() || "Shared Folder");
          addLog(`Shared folder selected!`);
        } else {
          Alert.alert(
            "Permission Denied",
            "You must grant permission to share files.",
          );
        }
      } else {
        // Fallback for newer Expo SDKs or iOS
        addLog(`Warning: SAF not available, using App Documents folder`);
        const docDir = FileSystem.documentDirectory || "";
        setSharedDirUri(docDir);
        sharedDirUriRef.current = docDir;
        setSharedDirName("App Documents");
        Alert.alert(
          "Using App Folder",
          "StorageAccessFramework is not available. Using internal app folder for testing.",
        );
      }
    } catch (err) {
      addLog(`Folder select error: ${err}`);
    }
  };

  const shareEntirePhone = async () => {
    try {
      await LocaldropServer.requestAllFilesAccess();
      const rootUri = "file:///storage/emulated/0";
      setSharedDirUri(rootUri);
      sharedDirUriRef.current = rootUri;
      setSharedDirName("Entire Phone Storage");
      addLog("Shared entire phone storage!");
    } catch (e) {
      addLog("Failed to share entire phone: " + e);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>LocalDrop Mobile</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>1. Select Folder to Share</Text>
        <TouchableOpacity style={styles.button} onPress={selectFolder}>
          <Text style={styles.buttonText}>
            {sharedDirUri && !sharedDirUri.startsWith("file://") ? "Change Folder" : "Select Specific Folder"}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.button, { marginTop: 10, backgroundColor: '#4f46e5' }]} onPress={shareEntirePhone}>
          <Text style={styles.buttonText}>
            {sharedDirUri?.startsWith("file://") ? "Refresh Entire Phone Access" : "Share Entire Phone (All Files)"}
          </Text>
        </TouchableOpacity>

        {sharedDirName && (
          <Text style={styles.infoText}>Sharing: {sharedDirName}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>2. Connect to PC</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter PC IP (e.g. 192.168.1.5)"
          placeholderTextColor="#666"
          value={pcIp}
          onChangeText={setPcIp}
          keyboardType="numbers-and-punctuation"
        />
        <TouchableOpacity
          style={[styles.button, connected ? styles.buttonConnected : {}]}
          onPress={connectToPc}
        >
          <Text style={styles.buttonText}>
            {connected ? "Reconnect" : "Connect"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.label}>Activity Log:</Text>
        <ScrollView style={styles.scrollView}>
          {logs.map((log, i) => (
            <Text key={i} style={styles.logText}>
              {log}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0f",
    padding: 20,
    paddingTop: 60,
  },
  header: {
    marginBottom: 30,
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
  },
  card: {
    backgroundColor: "#1a1a24",
    padding: 20,
    borderRadius: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#333",
  },
  label: {
    color: "#ccc",
    fontSize: 16,
    marginBottom: 10,
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#000",
    color: "#fff",
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#444",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#8b5cf6",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonConnected: {
    backgroundColor: "#10b981",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  infoText: {
    color: "#a78bfa",
    marginTop: 10,
    fontSize: 14,
  },
  logContainer: {
    flex: 1,
    backgroundColor: "#000",
    borderRadius: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: "#333",
  },
  scrollView: {
    flex: 1,
  },
  logText: {
    color: "#4ade80",
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 4,
  },
});
