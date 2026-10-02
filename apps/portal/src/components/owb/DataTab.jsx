/**
 * DataTab — where OWB will pull delivered data and report stats (acreage by
 * AVA/county, terrain, climate, soils, exports). Placeholder until the first
 * delineation milestone is delivered.
 */
import { alpha, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { lineLabel } from '../../lib/contractFormat';

export default function DataTab({ data }) {
  const delivered = data.milestones.filter(
    (m) => m.kind === 'milestone' && (m.status === 'delivered' || m.status === 'accepted')
  );
  return (
    <section style={{ border: `1px solid ${alpha(TOKENS.ink, 0.15)}`, borderRadius: 10, padding: '28px 20px' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', fontWeight: 600, margin: '0 0 8px' }}>
        Data &amp; reports
      </h2>
      <p style={{ color: muted, fontSize: 'var(--type-body-size)', lineHeight: 1.55, margin: 0, maxWidth: 620 }}>
        Delivered data will appear here as each milestone is delivered: acreage by AVA and county,
        terrain, climate and soils summaries, and full data exports for your reports.
      </p>
      {delivered.length > 0 && (
        <p style={{ fontSize: 'var(--type-body-size)', margin: '14px 0 0' }}>
          Delivered so far: {delivered.map((m) => lineLabel(m)).join(', ')}.
        </p>
      )}
    </section>
  );
}
