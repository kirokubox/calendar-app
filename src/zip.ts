// 写真つきバックアップ用の最小ZIP読み書き。外部ライブラリは使わない。
// 書き出しは無圧縮（stored）のみ。WebP/JPEGは既に圧縮済みなので、無圧縮でもサイズはほぼ変わらない。
// 読み込みは無圧縮と deflate の両方に対応する（解凍して再ZIPしたファイルも読めるようにするため）。

export type ZipInputFile = {
  path: string;
  blob: Blob;
};

export type ZipEntry = {
  path: string;
  blob: Blob;
};

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type PlannedEntry = {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
};

// ZIPを組み立てる。CRC計算のために1ファイルずつバイト列を読むが、
// 読み終えたら Blob 参照だけを持ち続けるので、ピーク時のメモリは1ファイル分に収まる
export async function createZipBlob(files: ZipInputFile[], modifiedAt: Date): Promise<Blob> {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(modifiedAt);
  const parts: BlobPart[] = [];
  const planned: PlannedEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(bytes);
    const size = bytes.length;

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    parts.push(header, file.blob);
    planned.push({ nameBytes, crc, size, offset });
    offset += header.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of planned) {
    const record = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    record.set(entry.nameBytes, 46);
    parts.push(record);
    centralSize += record.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, planned.length, true);
  endView.setUint16(10, planned.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralStart, true);
  endView.setUint16(20, 0, true);
  parts.push(end);

  return new Blob(parts, { type: "application/zip" });
}

async function inflateRaw(blob: Blob): Promise<Blob> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("このブラウザでは圧縮されたZIPを読み込めません。");
  }
  const stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).blob();
}

async function findEndOfCentralDirectory(blob: Blob): Promise<DataView> {
  const tailLength = Math.min(blob.size, 66000);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLength).arrayBuffer());
  const view = new DataView(tail.buffer);
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === END_OF_CENTRAL_SIGNATURE) {
      return new DataView(tail.buffer, index);
    }
  }
  throw new Error("ZIPファイルとして読み込めませんでした。");
}

// ZIP内のファイルを取り出す。データ部は Blob.slice で切り出すため、
// 無圧縮ファイルは全体をメモリへ展開しない
export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  const end = await findEndOfCentralDirectory(blob);
  const centralSize = end.getUint32(12, true);
  const centralStart = end.getUint32(16, true);
  const total = end.getUint16(10, true);

  const central = new Uint8Array(await blob.slice(centralStart, centralStart + centralSize).arrayBuffer());
  const centralView = new DataView(central.buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > central.length || centralView.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) break;
    const method = centralView.getUint16(cursor + 10, true);
    const compressedSize = centralView.getUint32(cursor + 20, true);
    const nameLength = centralView.getUint16(cursor + 28, true);
    const extraLength = centralView.getUint16(cursor + 30, true);
    const commentLength = centralView.getUint16(cursor + 32, true);
    const localOffset = centralView.getUint32(cursor + 42, true);
    // Windowsで再圧縮したZIPは区切りが「\」になることがあるため揃える
    const path = decoder.decode(central.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, "/");
    cursor += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) continue;

    // ローカルヘッダのファイル名長・拡張フィールド長を読んでからデータ位置を決める
    const localHeader = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    if (localHeader.byteLength < 30 || localHeader.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error("ZIPの構造を読み取れませんでした。");
    }
    const localNameLength = localHeader.getUint16(26, true);
    const localExtraLength = localHeader.getUint16(28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = blob.slice(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ path, blob: raw });
    } else if (method === 8) {
      entries.push({ path, blob: await inflateRaw(raw) });
    } else {
      throw new Error(`ZIP内の「${path}」は対応していない圧縮形式です。`);
    }
  }

  return entries;
}
