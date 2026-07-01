import { gzipSync } from "node:zlib";

export interface TarEntry {
	name: string;
	data: Buffer;
	mode?: number;
	mtime?: number;
}

function writeString(buf: Buffer, offset: number, length: number, value: string): void {
	buf.write(value.slice(0, length), offset, length, "utf8");
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
	const text = value
		.toString(8)
		.padStart(length - 1, "0")
		.slice(0, length - 1);
	buf.write(`${text}\0`, offset, length, "ascii");
}

function splitName(name: string): { name: string; prefix: string } {
	if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
	const parts = name.split("/");
	for (let i = 1; i < parts.length; i++) {
		const prefix = parts.slice(0, i).join("/");
		const rest = parts.slice(i).join("/");
		if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
			return { name: rest, prefix };
		}
	}
	throw new Error(`Tar entry path is too long: ${name}`);
}

function createHeader(entry: TarEntry): Buffer {
	if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.includes("\\")) {
		throw new Error(`Unsafe tar entry path: ${entry.name}`);
	}
	const header = Buffer.alloc(512, 0);
	const split = splitName(entry.name);
	writeString(header, 0, 100, split.name);
	writeOctal(header, 100, 8, entry.mode ?? 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, entry.data.length);
	writeOctal(header, 136, 12, Math.floor((entry.mtime ?? Date.now()) / 1000));
	header.fill(0x20, 148, 156);
	header[156] = "0".charCodeAt(0);
	writeString(header, 257, 6, "ustar");
	writeString(header, 263, 2, "00");
	writeString(header, 345, 155, split.prefix);
	let checksum = 0;
	for (const byte of header) checksum += byte;
	const checksumText = checksum.toString(8).padStart(6, "0");
	header.write(`${checksumText}\0 `, 148, 8, "ascii");
	return header;
}

function pad512(data: Buffer): Buffer {
	const remainder = data.length % 512;
	if (remainder === 0) return data;
	return Buffer.concat([data, Buffer.alloc(512 - remainder)]);
}

export function createTarGz(entries: TarEntry[]): Buffer {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		chunks.push(createHeader(entry));
		chunks.push(pad512(entry.data));
	}
	chunks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(chunks));
}
