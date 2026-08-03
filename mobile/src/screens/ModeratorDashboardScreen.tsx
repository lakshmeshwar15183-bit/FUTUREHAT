// Lumixo mobile — Moderator Dashboard (Phase 1). Native equivalent of
// web/src/moderator/ModeratorDashboard.tsx. Two sections — Reported Messages and
// Reported Profiles — over the reports surface (0017) + moderator RPCs (0023),
// with exactly five per-report actions: Review · Issue Warning · Close – No
// Violation · Close – Violation Confirmed · Escalate to Admin. Every action calls
// a SECURITY DEFINER RPC that re-checks moderator privilege and writes an
// immutable audit row. No admin-only powers (ban/suspend/delete/premium) here.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getServerModerator, adminListReports, adminSetReportStatus,
  issueWarning, escalateReport, REPORT_REASONS, WARNING_REASONS,
} from '../lib/shared';
import type { AdminReport, ReportStatus, WarningReason } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

const REASON_LABEL: Record<string, string> =
  Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));
const STATUS_LABEL: Record<string, string> = {
  open: 'Pending', reviewing: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed',
};
const FILTERS: { id: ReportStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Pending' },
  { id: 'reviewing', label: 'Reviewed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
];

function personLabel(name: string | null, username: string | null, id: string | null): string {
  return name || (username ? `@${username}` : id ? id.slice(0, 8) : 'unknown');
}

export default function ModeratorDashboardScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnFor, setWarnFor] = useState<AdminReport | null>(null);
  const [escFor, setEscFor] = useState<AdminReport | null>(null);

  // Whether a report of `status` belongs on-screen under the current filter. The
  // "All" tab is the moderator's ACTIVE work queue (open + reviewing) — NOT a dump
  // of every historical report — so a completed action leaves it; resolved and
  // dismissed reports are seen only under their own dedicated filters.
  const showsStatus = useCallback(
    (status: ReportStatus): boolean =>
      filter === 'all' ? status === 'open' || status === 'reviewing' : status === filter,
    [filter],
  );

  const load = useCallback(async () => {
    try {
      const rows = await adminListReports(supabase, filter === 'all' ? undefined : filter, 300);
      const visible = filter === 'all'
        ? rows.filter((r) => r.status === 'open' || r.status === 'reviewing')
        : rows;
      setReports(visible); setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load reports. Apply migration 0017 + 0023.');
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getServerModerator(supabase)
        .then((ok) => { if (alive) { setAllowed(ok); if (ok) load(); } })
        .catch(() => { if (alive) setAllowed(false); });
      return () => { alive = false; };
    }, [load]),
  );

  // Optimistically move a report to `newStatus`: update it in place, or drop it
  // from the queue immediately if it no longer belongs under the current filter
  // (No Violation → dismissed, Violation → resolved both leave the active queue).
  // Persist through the audited RPC; on failure, roll the list back and surface
  // the error. The UI updates instantly — no refetch round-trip.
  const applyStatus = useCallback(
    async (r: AdminReport, newStatus: ReportStatus, patch: Partial<AdminReport>, run: () => Promise<void>) => {
      const snapshot = reports;
      setBusy(r.report_id); setError(null);
      setReports((list) =>
        showsStatus(newStatus)
          ? list.map((x) => (x.report_id === r.report_id ? { ...x, status: newStatus, ...patch } : x))
          : list.filter((x) => x.report_id !== r.report_id),
      );
      try {
        await run();
      } catch (e: any) {
        setReports(snapshot);           // rollback the optimistic change
        setError(e?.message ?? 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [reports, showsStatus],
  );

  const review = (r: AdminReport) =>
    applyStatus(r, 'reviewing', {}, () => adminSetReportStatus(supabase, r.report_id, 'reviewing'));
  const closeNoViolation = (r: AdminReport) =>
    applyStatus(r, 'dismissed', {}, () => adminSetReportStatus(supabase, r.report_id, 'dismissed'));
  const closeViolation = (r: AdminReport) =>
    applyStatus(r, 'resolved', {}, () => adminSetReportStatus(supabase, r.report_id, 'resolved'));

  // Issuing a warning does NOT change the report's status (the moderator can still
  // close it afterwards), so the report stays in the queue — just persist + report.
  const runWarning = useCallback(async (r: AdminReport, reason: WarningReason, note?: string) => {
    if (!r.reported_user_id) return;
    setBusy(r.report_id); setError(null);
    try { await issueWarning(supabase, r.reported_user_id, reason, note, r.report_id); }
    catch (e: any) { setError(e?.message ?? 'Failed to issue warning'); }
    finally { setBusy(null); }
  }, []);

  if (allowed === null) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!allowed) return <View style={styles.center}><Text style={styles.empty}>You don’t have moderator access.</Text></View>;

  const messages = reports.filter((r) => r.target_type === 'message');
  const profiles = reports.filter((r) => r.target_type === 'user');

  const renderRow = (r: AdminReport, kind: 'message' | 'profile') => (
    <View key={r.report_id} style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.tag}>{REASON_LABEL[r.reason] ?? r.reason}</Text>
        {r.escalated ? <Text style={styles.escTag}>⬆ escalated</Text> : null}
        <Text style={styles.rowStatus}>{STATUS_LABEL[r.status] ?? r.status}</Text>
      </View>
      <Text style={styles.rowMeta}>Report {r.report_id.slice(0, 8)} · Reported: {personLabel(r.reported_name, r.reported_username, r.reported_user_id)}</Text>
      {kind === 'message' ? (
        <Text style={styles.quote}>
          {r.message_content ? `“${r.message_content}”` : '(no text / message deleted)'}
        </Text>
      ) : null}
      {r.description ? <Text style={styles.rowBody}>Note: {r.description}</Text> : null}
      {r.escalated && r.escalated_note ? <Text style={styles.rowBody}>Escalation note: {r.escalated_note}</Text> : null}
      <Text style={styles.rowMeta}>{new Date(r.created_at).toLocaleString()}</Text>
      <View style={styles.actions}>
        <MiniBtn label="👁 Review" onPress={() => review(r)} disabled={busy === r.report_id} colors={colors} />
        <MiniBtn label="⚠ Issue Warning" onPress={() => setWarnFor(r)} disabled={busy === r.report_id || !r.reported_user_id} colors={colors} />
        <MiniBtn label="✅ No Violation" onPress={() => closeNoViolation(r)} disabled={busy === r.report_id} colors={colors} />
        <MiniBtn label="🚩 Violation" onPress={() => closeViolation(r)} disabled={busy === r.report_id} danger colors={colors} />
        <MiniBtn label="⬆ Escalate" onPress={() => setEscFor(r)} disabled={busy === r.report_id} colors={colors} />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {FILTERS.map((f) => (
            <Pressable key={f.id} onPress={() => setFilter(f.id)} style={[styles.tabChip, filter === f.id && styles.tabChipActive]}>
              <Text style={[styles.tabText, filter === f.id && styles.tabTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {error ? <Text style={styles.warn}>{error}</Text> : null}

      <SafeScrollView contentContainerStyle={styles.listPad}>
        <Text style={styles.subhead}>Reported messages ({messages.length})</Text>
        {messages.length === 0 ? <Text style={styles.empty}>No reported messages.</Text> : messages.map((r) => renderRow(r, 'message'))}
        <Text style={styles.subhead}>Reported profiles ({profiles.length})</Text>
        {profiles.length === 0 ? <Text style={styles.empty}>No reported profiles.</Text> : profiles.map((r) => renderRow(r, 'profile'))}
      </SafeScrollView>

      <WarningModal
        report={warnFor}
        colors={colors}
        styles={styles}
        onClose={() => setWarnFor(null)}
        onSubmit={(reason, note) => {
          const r = warnFor;
          setWarnFor(null);
          if (r?.reported_user_id) runWarning(r, reason, note);
        }}
      />
      <EscalateModal
        report={escFor}
        colors={colors}
        styles={styles}
        onClose={() => setEscFor(null)}
        onSubmit={(note) => {
          const r = escFor;
          setEscFor(null);
          // Escalation flags the report for admins and moves it to 'reviewing'
          // (escalated). It stays in the moderator's active queue as a reviewed +
          // escalated item, and appears in the admin's active queue too.
          if (r) applyStatus(
            r,
            'reviewing',
            { escalated: true, escalated_note: note ?? null },
            () => escalateReport(supabase, r.report_id, note || undefined),
          );
        }}
      />
    </View>
  );
}

function WarningModal({
  report, colors, styles, onClose, onSubmit,
}: {
  report: AdminReport | null;
  colors: Palette; styles: Styles;
  onClose: () => void;
  onSubmit: (reason: WarningReason, note?: string) => void;
}) {
  const [reason, setReason] = useState<WarningReason>('spam');
  const [note, setNote] = useState('');
  const who = report ? personLabel(report.reported_name, report.reported_username, report.reported_user_id) : '';
  return (
    <Modal visible={!!report} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>⚠ Issue official warning</Text>
          <Text style={styles.modalHint}>An official Lumixo warning will be delivered to {who}’s mailbox and permanently recorded.</Text>
          <Text style={styles.modalLabel}>Reason</Text>
          <View style={styles.chipWrap}>
            {WARNING_REASONS.map((r) => (
              <Pressable key={r.value} onPress={() => setReason(r.value)} style={[styles.reasonChip, reason === r.value && styles.reasonChipActive]}>
                <Text style={[styles.reasonChipText, reason === r.value && styles.reasonChipTextActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.modalLabel}>Note to user (optional)</Text>
          <TextInput
            style={styles.modalInput} value={note} onChangeText={setNote}
            placeholder="Add context for the user…" placeholderTextColor={colors.textFaint} multiline
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
            <Pressable style={styles.modalSubmit} onPress={() => onSubmit(reason, note.trim() || undefined)}>
              <Text style={styles.modalSubmitText}>Send warning</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EscalateModal({
  report, colors, styles, onClose, onSubmit,
}: {
  report: AdminReport | null;
  colors: Palette; styles: Styles;
  onClose: () => void;
  onSubmit: (note?: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Modal visible={!!report} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>⬆ Escalate to Admin</Text>
          <Text style={styles.modalHint}>This report will be flagged for admin review.</Text>
          <Text style={styles.modalLabel}>Note for admins (optional)</Text>
          <TextInput
            style={styles.modalInput} value={note} onChangeText={setNote}
            placeholder="Why does this need admin attention?" placeholderTextColor={colors.textFaint} multiline
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
            <Pressable style={styles.modalSubmit} onPress={() => onSubmit(note.trim() || undefined)}>
              <Text style={styles.modalSubmitText}>Escalate</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MiniBtn({ label, onPress, danger, disabled, colors }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean; colors: Palette }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{
      paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: radius.sm,
      backgroundColor: danger ? colors.danger + '22' : colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth, borderColor: danger ? colors.danger : colors.border,
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    }]}>
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: font.tiny, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    empty: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', padding: spacing(6) },
    warn: { color: colors.danger, fontSize: font.small, padding: spacing(3) },
    subhead: { color: colors.text, fontSize: font.small, fontWeight: '700', marginTop: spacing(4), marginBottom: spacing(2) },
    tabBarWrap: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tabBar: { paddingHorizontal: spacing(2), paddingVertical: spacing(2), gap: spacing(2) },
    tabChip: { paddingHorizontal: spacing(3.5), paddingVertical: spacing(2), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
    tabChipActive: { backgroundColor: colors.primary },
    tabText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    tabTextActive: { color: '#fff' },
    listPad: { padding: spacing(3), paddingBottom: spacing(10) },
    row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3), marginBottom: spacing(2) },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(1) },
    rowStatus: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', marginLeft: 'auto' },
    rowBody: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    rowMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
    quote: { color: colors.text, fontSize: font.small, marginTop: spacing(1.5), fontStyle: 'italic', backgroundColor: colors.surfaceAlt, padding: spacing(2), borderRadius: radius.sm },
    tag: { color: colors.primary, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase' },
    escTag: { color: colors.primary, fontSize: font.tiny, fontWeight: '700', backgroundColor: colors.primary + '22', paddingHorizontal: spacing(1.5), paddingVertical: 1, borderRadius: radius.pill, overflow: 'hidden' },
    actions: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(2.5), flexWrap: 'wrap' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing(5) },
    modalCard: { width: '100%', maxWidth: 440, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    modalTitle: { color: colors.text, fontSize: font.heading, fontWeight: '800', marginBottom: spacing(2) },
    modalHint: { color: colors.textMuted, fontSize: font.small, lineHeight: 18, marginBottom: spacing(2) },
    modalLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing(2), marginBottom: spacing(1.5) },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
    reasonChip: { paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    reasonChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    reasonChipText: { color: colors.textMuted, fontSize: font.small },
    reasonChipTextActive: { color: '#fff', fontWeight: '700' },
    modalInput: { backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), fontSize: font.body, minHeight: 70, textAlignVertical: 'top' },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2), marginTop: spacing(4) },
    modalCancel: { paddingHorizontal: spacing(4), paddingVertical: spacing(2.5), borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
    modalCancelText: { color: colors.text, fontWeight: '700', fontSize: font.small },
    modalSubmit: { paddingHorizontal: spacing(4), paddingVertical: spacing(2.5), borderRadius: radius.md, backgroundColor: '#f59e0b' },
    modalSubmitText: { color: '#fff', fontWeight: '700', fontSize: font.small },
  });
