# BETII Campaign Manager · Nine candidates and AP2-9

A public, self-contained review snapshot of nine candidates from the edited BETII shortlist plus AP2-9 as the requested positive control. It includes the selected native structures, exact untagged and tagged sequences, model-specific confidence and saved affinity predictions.

Open **[Campaign Manager](https://benavt.github.io/BETII-campaign-review/?view=candidates)** or **[selection and sequences](https://benavt.github.io/BETII-campaign-review/triage.html)** after the Pages deployment completes.

## Selection

Rank the original ten candidates by `min(Kd_BRD2, Kd_BRD4, Kd_BRDT) / Kd_BRD3`, using only untagged Boltz2 Exact coordinates with matched saved DeltaForge scores and the same scorer calibration. Exclude LF-BRD3-r09, the lowest at 0.915×, and include AP2-9 separately as the control.

The panel contains **5 RFD3, 2 LigandForge, 1 AP Novo and 1 collaborator candidate, plus AP2-9**. These are design origins. Boltz2 Exact, AlphaFold 3, OpenDDE Exact and OpenFold are separate refolding methods; no candidate is assigned to only one of them.

This is a ranking within the user's edited shortlist, not a search of the entire design pool. Only four of the nine candidates exceed the historical provisional 10× predicted selectivity criterion. The remaining five are weaker-selectivity candidates/comparators. AP2-9 is a requested positive control whose archived role is a historical reference; no experimental control-validation record is supplied here.

## Structures and scope

Choose each sequence in the interface and select:

- Untagged or the full documented 64-residue tag.
- Boltz2 Exact, AlphaFold 3, OpenDDE Exact or OpenFold.
- Binder monomer, or complex with BRD3, BRD2, BRD4 or BRDT ET.

The publication manifest reports the actual available structures and any missing cells. The initial snapshot contains **392 of 400 comparisons**: AP2-9's eight OpenFold complexes are pending native calculation and validation. Its monomers and other three complex methods are available. Each comparison bundles its selected native model; additional native ensemble members remain in the original research archive.

All displayed affinities and selectivities are predictions. Tagged and untagged models and their scores remain separate. DeltaForge is **saved-scores-only**: the tagged panels for RFD3 1933 and C-34 have no saved Kds. A completed structure does not create a new Kd or establish biological function.

## Public snapshot

Everything under `docs/` is intentionally public. It contains only this selected panel and its referenced scientific assets, not the private multi-project workspace, raw provider responses, credentials, machine bindings or source-host paths. The original source hashes are retained. Original runs, failed attempts and underlying scientific outputs remain unchanged.

The site requires no private Mac service. Reviews stay in each browser; use **Data & backups** to exchange review metadata. Static hosting cannot run scientific jobs or paid scoring.

## Verification and updates

```sh
python3 scripts/verify_review.py
python3 -m unittest discover -s tests
node --test tests/*.test.mjs
```

`build_review.py` is the project-owned publication adapter for the pinned Campaign Manager revision. It runs on the source host with its scientific validators, checks full coordinate sequences/chains, hashes, exact selection, saved score provenance and asset closure, and creates a new immutable output. It never launches predictions or scoring. Update the committed snapshot only after those checks pass. The Pages workflow verifies the prebuilt package and deploys only `docs/`.
