import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function isEnveloped(buf: Buffer): boolean {
  if (buf.length < 26) return false;
  return (
    buf[0] === 0x88 &&
    buf[1] === 0x7d &&
    buf[2] === 0x1c &&
    buf[4] === 0x52 &&
    buf[5] === 0x06 &&
    buf[6] === 0x57 &&
    buf[7] === 0x00 &&
    buf[20] === 0x6b &&
    buf[21] === 0xec &&
    buf[22] === 0x75 &&
    buf[23] === 0x0a &&
    buf[24] === 0xfe &&
    buf[25] === 0xff
  );
}

function writeThenRead(data: Buffer, label: string): Buffer {
  const staging = path.join(os.tmpdir(), `workbench-import-${label}-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(staging, data);
    return fs.readFileSync(staging);
  } finally {
    try {
      fs.unlinkSync(staging);
    } catch {
    }
  }
}

function shellCandidates(): string[] {
  if (process.platform !== "win32") return ["bash", "sh"];

  const bases = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    "C:\Program Files",
    "C:\Program Files (x86)"
  ].filter(Boolean) as string[];

  return [...bases.map((base) => path.join(base, "Git", "bin", "bash.exe")), "bash"];
}

function copyViaShell(data: Buffer): Buffer | null {
  const stamp = `${process.pid}-${Date.now()}`;
  const source = path.join(os.tmpdir(), `workbench-import-src-${stamp}`);
  const copied = path.join(os.tmpdir(), `workbench-import-dst-${stamp}`);
  const toPosix = (p: string) => p.split(path.sep).join("/");

  try {
    fs.writeFileSync(source, data);

    for (const shell of shellCandidates()) {
      try {
        execFileSync(shell, ["-c", `cp -f '${toPosix(source)}' '${toPosix(copied)}'`], {
          stdio: "pipe",
          timeout: 20000
        });
      } catch {
        continue;
      }
      const out = fs.readFileSync(copied);
      if (!isEnveloped(out)) return out;
    }
    return null;
  } finally {
    for (const file of [source, copied]) {
      try {
        fs.unlinkSync(file);
      } catch {
      }
    }
  }
}

export function readUploadedFile(filePath: string): Buffer {
  const raw = fs.readFileSync(filePath);
  if (!isEnveloped(raw)) return raw;

  const staged = writeThenRead(raw, "stage");
  if (!isEnveloped(staged)) {
    return staged;
  }

  const viaShell = copyViaShell(raw);
  if (viaShell && !isEnveloped(viaShell)) {
    return viaShell;
  }
  throw new Error("read file error");
}
