const SAMPLE_BYTES = 65_536;

/** Only bounded edge samples are read. The returned File itself remains file-backed. */
export async function fileSampleDigest(file) {
  const first = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const last = new Uint8Array(
    await file.slice(Math.max(0, file.size - SAMPLE_BYTES)).arrayBuffer(),
  );
  const bytes = new Uint8Array(first.length + last.length);
  bytes.set(first);
  bytes.set(last, first.length);
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateDescriptor(value) {
  if (
    !value ||
    typeof value.localName !== "string" ||
    value.localName.length > 255 ||
    !/^[^\\/]+\.mp4$/iu.test(value.localName) ||
    value.localName.includes(String.fromCharCode(0)) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > 32_000_000_000 ||
    !Number.isSafeInteger(value.lastModified) ||
    value.lastModified < 0 ||
    typeof value.sampleDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sampleDigest)
  )
    throw new Error("缓存视频信息无效，请重新选择原视频。");
}

async function readMatchingFile(directory, descriptor) {
  validateDescriptor(descriptor);
  let file;
  try {
    file = await (await directory.getFileHandle(descriptor.localName)).getFile();
  } catch {
    throw new Error("所选目录中没有这份缓存，请选择页面显示的缓存视频文件夹。");
  }
  if (
    file.name !== descriptor.localName ||
    file.size !== descriptor.size ||
    file.lastModified !== descriptor.lastModified ||
    (await fileSampleDigest(file)) !== descriptor.sampleDigest
  )
    throw new Error("缓存视频不匹配或已变化，请重新选择原视频和缓存目录。");
  return file;
}

export function createLocalFileReader({ storage, pickDirectory }) {
  return {
    async authorize(id, descriptor) {
      validateDescriptor(descriptor);
      const previous = await storage.get(id);
      if (previous) {
        if ((await previous.requestPermission({ mode: "read" })) !== "granted")
          throw new Error("目录未授权，请再次点击授权缓存目录后允许读取。");
        try {
          await readMatchingFile(previous, descriptor);
          return;
        } catch {
          // A moved/replaced directory must be selected again, not silently substituted.
          await storage.set(id, undefined);
        }
      }
      const directory = await pickDirectory({ id: "seen-said-cache", mode: "read" });
      await readMatchingFile(directory, descriptor);
      await storage.set(id, directory);
    },
    async read(id, descriptor) {
      validateDescriptor(descriptor);
      const directory = await storage.get(id);
      if (!directory || (await directory.queryPermission({ mode: "read" })) !== "granted")
        throw new Error("请先授权读取本集所在的缓存视频文件夹。");
      return readMatchingFile(directory, descriptor);
    },
  };
}

export function browserFileReader(view) {
  const database = new Promise((resolve, reject) => {
    const request = view.indexedDB.open("seen-said-local-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("directories");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法保存缓存目录授权。"));
  });
  // IndexedDB stores native handles, never media contents or a second video copy.
  const transact = async (mode, operation) => {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("directories", mode);
      const request = operation(transaction.objectStore("directories"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(new Error("缓存目录授权记录不可用。"));
    });
  };
  return createLocalFileReader({
    storage: {
      get: (id) => transact("readonly", (store) => store.get(id)),
      set: (id, handle) =>
        transact("readwrite", (store) => (handle ? store.put(handle, id) : store.delete(id))),
    },
    pickDirectory: (options) => view.showDirectoryPicker(options),
  });
}
