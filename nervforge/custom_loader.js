async function customLoader(url) {
    // Download the zipped WASM file
    const response = await fetch(url);
    const contentLength = response.headers.get("content-length");
    const total = parseInt(contentLength, 10);
    let loaded = 0;

    const reader = response.body.getReader();
    const chunks = [];

    console.log("Downloading wasm file...");
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        const progress = ((loaded / total) * 100).toFixed(2);
        document.getElementById(
            "progress"
        ).textContent = `Downloading: ${progress}%`;
    }

    console.log("Assembling wasm file...");
    document.getElementById("progress").textContent = "Assembling...";
    const wasmData = new Uint8Array(
        chunks.reduce((acc, chunk) => [...acc, ...chunk], [])
    );

    document.getElementById("progress").textContent = "Ready!";
    return wasmData;
    // return unzippedData;
}

function fetchProgress(filePath, progressCallback) {
    var fullPath = filePath;
    return fetch(fullPath)
        .then(function (response) {
            if (!response.ok) {
                let err = `${response.status} (${response.statusText}) from ${response.url}`;

                handleError(err);
                return Promise.reject(err);
            } else {
                // Start reading the response as a stream

                const contentLength = +response.headers.get("Content-Length");
                const reader = response.body.getReader();
                let receivedBytes = 0;
                let chunks = [];

                // function delay(ms) {
                //     return new Promise((resolve) => setTimeout(resolve, ms));
                // }

                function readChunk() {
                    return reader.read().then(function ({ done, value }) {
                        if (done) {
                            // All data has been downloaded
                            return chunks;
                        }

                        chunks.push(value);
                        receivedBytes += value.length;
                        const progress = (receivedBytes / contentLength) * 100;
                        const progVal = progress.toFixed(2);

                        progressCallback(receivedBytes, contentLength);

                        let msg = `Downloading: ${receivedBytes}/${contentLength} (${progVal} %)`;
                        if (receivedBytes == contentLength) {
                            msg = "Download completed.";
                        }
                        console.log(msg);

                        // document.getElementById("progress").textContent = msg;
                        // self.loaderSubState = msg;
                        // setStatus("Loading"); // trigger loaderSubState update

                        // Need to add "async" to the function for this:
                        // await delay(500);

                        return readChunk(); // Read the next chunk
                    });
                }

                return readChunk();
            }
        })
        .then(function (chunks) {
            // All data has been downloaded
            const blob = new Blob(chunks);

            // Process the downloaded blob as needed
            console.log("Download completed");

            return blob;
        });
}

// Function to fetch metadata of the file using HEAD request
function fetchFileSize(filePath) {
    return fetch(filePath, {
        method: "HEAD",
    }).then(function (response) {
        // Extract and return the content length from response headers
        var fileSize = parseInt(response.headers.get("content-length"));
        console.log("File size for " + filePath + " is " + fileSize);
        return fileSize;
    });
}

function storeFileInIDBFS(appName, filePath, compressedSize, buffer) {
    return new Promise(function (resolve, reject) {
        var request = window.indexedDB.open(appName, 2);

        request.onupgradeneeded = function (event) {
            var db = request.result;

            if (!db.objectStoreNames.contains("files")) {
                db.createObjectStore("files", { keyPath: "filePath" });
            }
        };

        request.onsuccess = function (event) {
            var db = request.result;
            var transaction = db.transaction("files", "readwrite");
            var objectStore = transaction.objectStore("files");

            // Create an object containing the file path and buffer
            var fileData = {
                filePath: filePath,
                buffer: buffer,
                compressedSize: compressedSize,
            };

            // Add or rather put the object to the object store
            // put also supports updating an existing object.

            // var addRequest = objectStore.add(fileData);
            var putRequest = objectStore.put(fileData);

            putRequest.onsuccess = function (event) {
                resolve(buffer);
            };

            putRequest.onerror = function (event) {
                reject(event.target.error);
            };

            transaction.oncomplete = function () {
                db.close();
            };
        };

        request.onerror = function (event) {
            reject(event.target.error);
        };
    });
}

// Function to get the size of a file stored in IndexedDB:
function getFileRecordFromIDBFS(appName, filePath) {
    return new Promise(function (resolve, reject) {
        // Open the IndexedDB database
        var request = window.indexedDB.open(appName, 2);

        request.onupgradeneeded = function (event) {
            var db = request.result;

            if (!db.objectStoreNames.contains("files")) {
                db.createObjectStore("files", { keyPath: "filePath" });
            }
        };

        // Handle database opening success
        request.onsuccess = function (event) {
            var db = request.result;

            // Start a transaction to access the object store
            var transaction = db.transaction("files", "readonly");

            // Get the object store
            var objectStore = transaction.objectStore("files");

            // Get the file record by filePath
            var getFileRequest = objectStore.get(filePath);

            // Handle getFileRequest success
            getFileRequest.onsuccess = function (event) {
                var fileRecord = event.target.result;
                if (fileRecord) {
                    // If the file record exists, resolve with it
                    resolve(fileRecord);
                } else {
                    // If the file record doesn't exist, resolve with null
                    resolve(null);
                }
            };

            // Handle getFileRequest error
            getFileRequest.onerror = function (event) {
                reject(event.target.error);
            };

            transaction.oncomplete = function () {
                db.close();
            };
        };

        // Handle database opening error
        request.onerror = function (event) {
            reject(event.target.error);
        };
    });
}

function fetchCompileCompressedWasm(appName, progressCallback) {
    // console.log('Fetching resource: ' + appName)
    // return fetchResource(appName + '.br')
    var fileUrl = appName + ".wasm.br";
    var remoteFileSize = undefined;

    return fetchFileSize(fileUrl)
        .then(function (fileSize) {
            remoteFileSize = fileSize;
            // Check if we have a local copy of this file:
            return getFileRecordFromIDBFS(appName, fileUrl);
        })
        .then(function (fileRecord) {
            if (
                fileRecord != null &&
                fileRecord.compressedSize == remoteFileSize
            ) {
                // Return the cached data:
                console.log("File already cached!");
                return fileRecord.buffer;
            }

            if (fileRecord == null) {
                console.log("No file record, downloading...");
            } else {
                console.log("Remote file size was updated, downloading... ");
            }

            return fetchProgress(fileUrl, progressCallback).then(function (
                response
            ) {
                // Note: the "response" will rather be a blob when using fetchProgress,
                // but we have an arrayBuffer() method there too.

                // Content is Brotli-encoded, decode it
                return response.arrayBuffer().then(function (buffer) {
                    // console.log("Trying to decode buffer of size "+ buffer.byteLength)
                    const stageText = document.getElementById("stage");
                    // stageText.textContent = "Decompressing...";
                    stageText.textContent = "Compiling...";

                    var decodedBuffer = BrotliDecode(new Uint8Array(buffer));

                    // Store the file buffer in IDB:
                    return storeFileInIDBFS(
                        appName,
                        fileUrl,
                        buffer.byteLength,
                        decodedBuffer.buffer
                    );
                });
            });
        });

    // Should not compile here:
    // .then(function (buffer) {
    //     // self.loaderSubState = "Compiling";
    //     // setStatus("Loading"); // trigger loaderSubState update
    //     console.log("Compiling wasm...");
    //     return WebAssembly.compile(buffer);
    // });
}
