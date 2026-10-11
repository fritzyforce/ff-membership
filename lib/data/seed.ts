import type { Applicant } from "@/lib/types";

/**
 * Data dummy HANYA untuk alur rekrutmen baru (belum dimigrasi ke Supabase).
 * Anggota, akun, registrasi ulang, dan uang kas sudah memakai data nyata
 * (lihat README); email dummy memakai domain `.test`.
 */

function phoneFor(num: string) {
  return `0812${num}${num.slice(0, 3)}`;
}

function applicant(
  num: string,
  fullName: string,
  slug: string,
  extra: Partial<Applicant>,
): Applicant {
  return {
    id: `app-${num}`,
    code: `REG-2026-${num}`,
    fullName,
    birthPlace: "Jakarta",
    birthDate: "2002-01-01",
    address: "Jl. Contoh No. 1, Jakarta",
    socialX: "",
    socialInstagram: "",
    socialTiktok: "",
    email: `${slug}@fritzyforce.test`,
    phone: phoneFor(num),
    lineId: slug,
    status: "pending",
    reviewNote: "",
    paymentProof: null,
    memberNumber: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    ...extra,
  };
}

export const SEED_APPLICANTS: Applicant[] = [
  applicant("0420", "Nadia Safitri", "nadia.safitri", {
    birthPlace: "Bandung",
    birthDate: "2004-04-04",
    address: "Jl. Braga No. 2, Bandung",
    socialInstagram: "@nadiasaf",
    status: "payment_submitted",
    paymentProof: "bukti-transfer-nadia.jpg",
    createdAt: "2026-09-30T08:10:00.000Z",
  }),
  applicant("0419", "Oka Prasetyo", "oka.prasetyo", {
    birthPlace: "Denpasar",
    birthDate: "2000-08-17",
    address: "Jl. Teuku Umar No. 77, Denpasar, Bali",
    socialX: "@okap",
    status: "pre_approved",
    createdAt: "2026-09-29T13:25:00.000Z",
  }),
  applicant("0418", "Putri Maharani", "putri.maharani", {
    birthPlace: "Medan",
    birthDate: "2003-06-23",
    address: "Jl. Gatot Subroto No. 15, Medan",
    socialTiktok: "@putrimhr",
    createdAt: "2026-09-28T16:40:00.000Z",
  }),
  applicant("0417", "Aulia Rahma", "aulia.rahma", {
    birthPlace: "Bandung",
    birthDate: "2001-05-14",
    address: "Jl. Melati No. 12, Kel. Sukajadi, Bandung, Jawa Barat",
    socialInstagram: "@aulia.rahma",
    status: "approved",
    paymentProof: "bukti-transfer-aulia.jpg",
    memberNumber: "FF-2026-0417",
    createdAt: "2026-04-12T10:00:00.000Z",
  }),
  applicant("0416", "Gilang Saputra", "gilang.saputra", {
    birthPlace: "Bogor",
    birthDate: "2001-09-09",
    address: "Jl. Suryakencana No. 4, Bogor",
    socialX: "@gilangs",
    createdAt: "2026-09-26T11:00:00.000Z",
  }),
  applicant("0415", "Hana Salsabila", "hana.salsabila", {
    birthPlace: "Depok",
    birthDate: "2004-12-12",
    address: "Jl. Juanda No. 21, Depok",
    socialTiktok: "@hanasalsa",
    createdAt: "2026-09-25T15:30:00.000Z",
  }),
  applicant("0414", "Ilham Firmansyah", "ilham.firmansyah", {
    birthPlace: "Bekasi",
    birthDate: "1998-03-03",
    address: "Jl. Ahmad Yani No. 10, Bekasi",
    socialInstagram: "@ilham.f",
    status: "rejected",
    reviewNote: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    createdAt: "2026-09-24T09:15:00.000Z",
  }),
  applicant("0413", "Jasmine Putri", "jasmine.putri", {
    birthPlace: "Bekasi",
    birthDate: "2003-02-08",
    address: "Jl. Cempaka No. 7, Bekasi Timur, Jawa Barat",
    socialInstagram: "@jasmine.p",
    status: "approved",
    paymentProof: "bukti-transfer-jasmine.jpg",
    memberNumber: "FF-2026-0413",
    createdAt: "2026-09-20T08:00:00.000Z",
  }),
];
