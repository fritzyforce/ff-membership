import { Badge, InfoRow } from "@/components/ui/primitives";
import { DUES_STATUS, birthLine, formatDateShort, formatPeriod, formatPeriodRange, formatRupiah, socialsOf } from "@/lib/format";
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
      {member.oldMemberNumber && <InfoRow label="Nomor Anggota Lama" value={member.oldMemberNumber} />}
      {socialsOf(member).map((s) => (
        <InfoRow key={s.label} label={s.long} value={s.value} />
      ))}
    </>
  );
}

/** Tabel riwayat uang kas (desktop). `action` opsional per baris. */
export function DuesTable({
  dues,
  action,
}: {
  dues: DuesPayment[];
  action?: (d: DuesPayment) => React.ReactNode;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead>
          <tr>
            <th>Periode</th>
            <th>Tanggal Bayar</th>
            <th>Nominal</th>
            <th>Status</th>
            {action && <th aria-label="Aksi" />}
          </tr>
        </thead>
        <tbody>
          {dues.length === 0 && (
            <tr>
              <td colSpan={action ? 5 : 4} className="text-center">
                Belum ada riwayat pembayaran.
              </td>
            </tr>
          )}
          {dues.map((d) => (
            <tr key={d.id} className="whitespace-nowrap">
              <td>
                {formatPeriodRange(d.periodFrom, d.periodTo)}
                {d.months > 1 && <span className="text-caption ml-2">{d.months} bulan</span>}
              </td>
              <td>{formatDateShort(d.paidAt)}</td>
              <td>{formatRupiah(d.amount)}</td>
              <td>
                <Badge tone={DUES_STATUS[d.status].badge}>{DUES_STATUS[d.status].label}</Badge>
              </td>
              {action && <td className="text-right">{action(d)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Kartu riwayat uang kas (mobile). */
export function DuesCards({ dues }: { dues: DuesPayment[] }) {
  if (dues.length === 0) {
    return <div className="card-flat text-body-sm">Belum ada riwayat pembayaran.</div>;
  }
  return (
    <>
      {dues.map((d) => (
        <div key={d.id} className="card-flat row items-center justify-between">
          <div className="stack gap-[2px]">
            <div className="text-body-sm font-semibold text-gold-100">{formatPeriodRange(d.periodFrom, d.periodTo)}</div>
            <div className="text-caption">
              {d.status === "paid"
                ? `Dibayar ${formatDateShort(d.paidAt)}`
                : d.status === "processing"
                  ? "Menunggu verifikasi admin"
                  : `Ditolak: ${d.reviewNote}`}
            </div>
          </div>
          <div className="stack items-end gap-1">
            <div className="text-body-sm text-gold-100">{formatRupiah(d.amount)}</div>
            <Badge tone={DUES_STATUS[d.status].badge}>{DUES_STATUS[d.status].label}</Badge>
          </div>
        </div>
      ))}
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
