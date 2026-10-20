"use client";

import { Fragment, useState } from "react";

import { Badge, InfoRow } from "@/components/ui/primitives";
import {
  DUES_SOURCE,
  DUES_STATUS,
  birthLine,
  formatDateShort,
  formatDateTimeShort,
  formatPeriod,
  formatPeriodRange,
  formatRupiah,
  socialsOf,
} from "@/lib/format";
import type { DuesPayment, DuesSummary, Member } from "@/lib/types";

/** Baris-baris profil yang dipakai di Akun Saya & Admin Member Detail. */
export function ProfileRows({ member, withBirth = true }: { member: Member; withBirth?: boolean }) {
  return (
    <>
      <InfoRow label="Nickname" value={member.nickname || "—"} />
      {withBirth && <InfoRow label="Tanggal Lahir" value={birthLine(member)} />}
      <InfoRow label="Domisili" value={member.domicile || "—"} />
      <InfoRow label="Alamat Lengkap" value={member.address || "—"} />
      <InfoRow label="ID Line" value={member.lineId} />
      {socialsOf(member).map((s) => (
        <InfoRow key={s.label} label={s.long} value={s.value} />
      ))}
    </>
  );
}

/** "Tanggal approve" per status: tanggal verifikasi (paid), tanggal ditolak (rejected), atau menunggu. */
function approveLabel(d: DuesPayment) {
  if (d.status === "paid") return formatDateShort(d.paidAt);
  if (d.status === "rejected") return `Ditolak ${formatDateShort(d.reviewedAt)}`;
  return "Menunggu";
}

function periodsText(d: DuesPayment) {
  const list = d.periods.length > 0 ? d.periods : [d.periodFrom];
  return list.map(formatPeriod).join(", ");
}

/** Rincian satu pembayaran: asal, bulan dibayar, nominal, tanggal bayar vs tanggal approve, catatan. */
function DuesDetail({ d }: { d: DuesPayment }) {
  const rows: [string, React.ReactNode][] = [
    ["Asal pembayaran", DUES_SOURCE[d.source]],
    ["Bulan dibayar", `${periodsText(d)} (${d.months} bulan)`],
    ["Nominal", formatRupiah(d.amount)],
    ["Tanggal bayar", formatDateShort(d.paidOn)],
    [d.status === "rejected" ? "Tanggal ditolak" : "Tanggal approve", d.status === "processing" ? "Menunggu verifikasi admin" : formatDateTimeShort(d.reviewedAt)],
    ["Status", <Badge key="s" tone={DUES_STATUS[d.status].badge}>{DUES_STATUS[d.status].label}</Badge>],
  ];
  if (d.status === "rejected" && d.reviewNote) rows.push(["Catatan penolakan", d.reviewNote]);
  return (
    <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="stack gap-[2px]">
          <dt className="text-caption">{label}</dt>
          <dd className="text-body-sm m-0 break-words text-gold-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tabel riwayat uang kas (desktop). `action` opsional per baris. Baris bisa dibuka untuk melihat rincian. */
export function DuesTable({
  dues,
  action,
}: {
  dues: DuesPayment[];
  action?: (d: DuesPayment) => React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const cols = action ? 7 : 6;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead>
          <tr>
            <th>Bulan Dibayar</th>
            <th>Tanggal Bayar</th>
            <th>Tanggal Approve</th>
            <th>Nominal</th>
            <th>Status</th>
            <th aria-label="Rincian" />
            {action && <th aria-label="Aksi" />}
          </tr>
        </thead>
        <tbody>
          {dues.length === 0 && (
            <tr>
              <td colSpan={cols} className="text-center">
                Belum ada riwayat pembayaran.
              </td>
            </tr>
          )}
          {dues.map((d) => {
            const open = openId === d.id;
            return (
              <Fragment key={d.id}>
                <tr className="whitespace-nowrap">
                  <td>
                    {formatPeriodRange(d.periodFrom, d.periodTo)}
                    {d.months > 1 && <span className="text-caption ml-2">{d.months} bulan</span>}
                  </td>
                  <td>{formatDateShort(d.paidOn)}</td>
                  <td>{approveLabel(d)}</td>
                  <td>{formatRupiah(d.amount)}</td>
                  <td>
                    <Badge tone={DUES_STATUS[d.status].badge}>{DUES_STATUS[d.status].label}</Badge>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : d.id)}
                    >
                      {open ? "Tutup rincian" : "Rincian"}
                    </button>
                  </td>
                  {action && <td className="text-right">{action(d)}</td>}
                </tr>
                {open && (
                  <tr>
                    <td colSpan={cols} className="whitespace-normal">
                      <DuesDetail d={d} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Kartu riwayat uang kas (mobile), dengan rincian yang bisa dibuka. */
export function DuesCards({ dues }: { dues: DuesPayment[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (dues.length === 0) {
    return <div className="card-flat text-body-sm">Belum ada riwayat pembayaran.</div>;
  }
  return (
    <>
      {dues.map((d) => {
        const open = openId === d.id;
        return (
          <div key={d.id} className="card-flat stack gap-3">
            <div className="row items-start justify-between gap-3">
              <div className="stack gap-[2px]">
                <div className="text-body-sm font-semibold text-gold-100">{formatPeriodRange(d.periodFrom, d.periodTo)}</div>
                <div className="text-caption">Dibayar {formatDateShort(d.paidOn)}</div>
                <div className="text-caption">Approve: {approveLabel(d)}</div>
              </div>
              <div className="stack items-end gap-1">
                <div className="text-body-sm text-gold-100">{formatRupiah(d.amount)}</div>
                <Badge tone={DUES_STATUS[d.status].badge}>{DUES_STATUS[d.status].label}</Badge>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-secondary self-start"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : d.id)}
            >
              {open ? "Tutup rincian" : "Rincian"}
            </button>
            {open && <DuesDetail d={d} />}
          </div>
        );
      })}
    </>
  );
}

/** Ringkasan iuran: sejak kapan ditagih, tunggakan, dan bulan yang akan dibayar berikutnya. */
export function DuesSummaryCard({ summary }: { summary: DuesSummary }) {
  const arrears = summary.arrearsCount;
  return (
    <div className="card-flat stack gap-3">
      <div className="row items-center justify-between gap-3">
        <div className="text-body-sm font-semibold text-gold-100">Status Iuran</div>
        <Badge tone={arrears > 0 ? "reject" : "approved"} dot={arrears > 0}>
          {arrears > 0 ? `Tunggakan ${arrears} bulan` : "Tidak ada tunggakan"}
        </Badge>
      </div>
      <div className="stack gap-2">
        <div className="row justify-between gap-4">
          <span className="text-body-sm">Iuran per bulan</span>
          <span className="text-body-sm text-gold-100">{formatRupiah(summary.monthlyAmount)}</span>
        </div>
        <div className="row justify-between gap-4">
          <span className="text-body-sm">Dihitung sejak</span>
          <span className="text-body-sm text-gold-100">{formatPeriod(summary.startPeriod)}</span>
        </div>
        <div className="row justify-between gap-4">
          <span className="text-body-sm">Bulan dibayar sampai</span>
          <span className="text-body-sm text-gold-100">
            {summary.coveredThrough ? formatPeriod(summary.coveredThrough) : "Belum ada pembayaran"}
          </span>
        </div>
        <div className="row justify-between gap-4">
          <span className="text-body-sm">Pembayaran berikutnya untuk</span>
          <span className="text-body-sm text-gold-100">
            {summary.nextPeriod ? formatPeriod(summary.nextPeriod) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
