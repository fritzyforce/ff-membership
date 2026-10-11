/**
 * Repository dummy (localStorage) — HANYA untuk alur rekrutmen baru yang belum
 * dimigrasi ke Supabase. Anggota, akun, registrasi ulang, dan uang kas sudah
 * memakai data nyata di lib/data/{members,dues,re-registrations}.ts.
 */
import { SEED_APPLICANTS } from "@/lib/data/seed";
import { DataError } from "@/lib/errors";
import type { Applicant } from "@/lib/types";

const DB_KEY = "ff-membership-db-v4";
export const DB_CHANGE_EVENT = "ff-db-change";

interface Db {
  applicants: Applicant[];
}

function seedDb(): Db {
  // structuredClone supaya seed asli tidak ikut termutasi
  return structuredClone({ applicants: SEED_APPLICANTS });
}

let memoryDb: Db | null = null;

function readDb(): Db {
  if (memoryDb) return memoryDb;
  try {
    const raw = window.localStorage.getItem(DB_KEY);
    memoryDb = raw ? (JSON.parse(raw) as Db) : seedDb();
  } catch {
    memoryDb = seedDb();
  }
  return memoryDb;
}

function writeDb(db: Db) {
  memoryDb = db;
  try {
    window.localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // storage penuh / diblokir: data tetap hidup di memori selama tab terbuka
  }
  window.dispatchEvent(new Event(DB_CHANGE_EVENT));
}

function mutate<T>(fn: (db: Db) => T): T {
  const db = structuredClone(readDb());
  const result = fn(db);
  writeDb(db);
  return result;
}

/** Simulasi latensi jaringan supaya state loading ikut teruji. */
function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export { DataError };

export async function resetDummyData() {
  writeDb(seedDb());
  return delay(true);
}

/* ------------------------------------------------------------------ */
/* Pendaftaran (applicants)                                            */
/* ------------------------------------------------------------------ */

export type ApplicationInput = Pick<
  Applicant,
  | "fullName"
  | "birthPlace"
  | "birthDate"
  | "address"
  | "socialX"
  | "socialInstagram"
  | "socialTiktok"
  | "email"
  | "phone"
  | "lineId"
>;

function codeNumber(code: string) {
  return Number(code.split("-").pop()) || 0;
}

function pad(n: number) {
  return String(n).padStart(4, "0");
}

/** Nomor urut berikutnya untuk kode REG dummy. */
function nextSerial(db: Db) {
  return Math.max(0, ...db.applicants.map((a) => codeNumber(a.code))) + 1;
}

export async function getApplicants() {
  const list = [...readDb().applicants].sort((a, b) =>
    b.code.localeCompare(a.code),
  );
  return delay(list);
}

export async function getApplicant(id: string) {
  return delay(readDb().applicants.find((a) => a.id === id) ?? null);
}

/** Cari pendaftaran berdasarkan kode REG atau email (case-insensitive). */
export async function findApplicant(query: string) {
  const q = query.trim().toLowerCase();
  const found =
    readDb().applicants.find(
      (a) => a.code.toLowerCase() === q || a.email.toLowerCase() === q,
    ) ?? null;
  return delay(found, 300);
}

export async function submitApplication(input: ApplicationInput) {
  const result = mutate((db) => {
    const email = input.email.trim().toLowerCase();
    const dup = db.applicants.find(
      (a) => a.email.toLowerCase() === email && a.status !== "rejected",
    );
    if (dup) {
      throw new DataError(
        `Email ini sudah terdaftar dengan kode ${dup.code}. Gunakan Cek Status.`,
      );
    }
    const next = nextSerial(db);
    const applicant: Applicant = {
      ...input,
      email,
      id: `app-${pad(next)}`,
      code: `REG-${new Date().getFullYear()}-${pad(next)}`,
      status: "pending",
      reviewNote: "",
      paymentProof: null,
      memberNumber: null,
      createdAt: new Date().toISOString(),
    };
    db.applicants.push(applicant);
    return applicant;
  });
  return delay(result, 400);
}

/** Pendaftar (status pre_approved) mengirim bukti bayar uang kas. */
export async function submitApplicantPayment(id: string, fileName: string) {
  const result = mutate((db) => {
    const a = db.applicants.find((x) => x.id === id);
    if (!a) throw new DataError("Pendaftaran tidak ditemukan.");
    if (a.status !== "pre_approved") {
      throw new DataError("Pendaftaran ini tidak sedang menunggu pembayaran.");
    }
    a.status = "payment_submitted";
    a.paymentProof = fileName;
    return a;
  });
  return delay(result, 400);
}

/**
 * Approve dua tahap sesuai alur design:
 *   pending           -> pre_approved (lolos review, lanjut bayar uang kas)
 *   payment_submitted -> approved     (pembayaran terverifikasi, jadi anggota)
 */
export async function approveApplicant(id: string, note?: string) {
  const result = mutate((db) => {
    const a = db.applicants.find((x) => x.id === id);
    if (!a) throw new DataError("Pendaftaran tidak ditemukan.");
    if (note !== undefined) a.reviewNote = note;

    if (a.status === "pending") {
      a.status = "pre_approved";
      return a;
    }
    if (a.status === "payment_submitted") {
      // Dummy: nomor format lama (FF-YYYY-NNNN). Saat rekrutmen dimigrasi, nomor FF-NNN
      // dibuat database lewat approve (lihat next_member_number()).
      a.status = "approved";
      a.memberNumber = `FF-${a.code.split("-")[1]}-${pad(codeNumber(a.code))}`;
      return a;
    }
    throw new DataError("Status pendaftaran ini tidak bisa di-approve.");
  });
  return delay(result);
}

export async function rejectApplicant(id: string, note?: string) {
  const result = mutate((db) => {
    const a = db.applicants.find((x) => x.id === id);
    if (!a) throw new DataError("Pendaftaran tidak ditemukan.");
    if (a.status === "approved") {
      throw new DataError("Pendaftar yang sudah jadi anggota tidak bisa di-reject.");
    }
    a.status = "rejected";
    if (note !== undefined) a.reviewNote = note;
    return a;
  });
  return delay(result);
}
