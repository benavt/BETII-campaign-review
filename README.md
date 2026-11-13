# BETII Campaign Manager

A public, self-contained review snapshot of nine candidates from the edited BETII shortlist plus AP2-9 as the requested positive control. It includes the selected native structures, exact untagged and tagged sequences, model-specific confidence and saved affinity predictions.

Open **[Campaign Manager](https://benavt.github.io/BETII-campaign-review/?view=candidates)** or **[selection and sequences](https://benavt.github.io/BETII-campaign-review/triage.html)**.

## Jokent collaborator sequences

Open **[Jokent Sequences](https://benavt.github.io/BETII-campaign-review/jokent/?view=explorer)** or the **[complete folding status and downloads](https://benavt.github.io/BETII-campaign-review/jokent/status.html)**. This separate review contains all 18 unique sequences supplied in the two collaborator FASTAs, used as supplied without tags. The modified FASTA repeats ten original sequences.

The saved snapshot publishes **256 of 288 binder–ET complexes, 67 of 72 binder monomers, and 55 of 72 binder homodimer conditions**, across Boltz2 Exact, AlphaFold 3, OpenDDE Exact and OpenFold. Each available homodimer condition includes all five native models, giving **598 coordinate files** in total. All 432 requested conditions remain visible in the status table, including the 54 still pending validated publication.

NetSolP-D solubility and purification usability scores are complete for all 18 sequences. **48 of 72 Boltz2 Exact isoform conditions** have coordinate-matched PCANN predictions, including Kd and ΔG downloads. Native pTM, ipTM, mean pLDDT and ipSAE are included where the source method reports them. No new DeltaForge predictions were made; missing scores remain absent under the saved-scores-only policy. These predictions do not establish experimental binding or selectivity.

The original nine-candidate plus AP2-9 scientific workspace and all of its assets remain unchanged. `build_jokent.py` builds only the independently authorized collaborator cohort, and `verify_jokent.py` verifies its frozen sequences, canonical isoforms, native chains, hashes, metrics and asset closure.

## Selection

Rank the original ten candidates by `min(Kd_BRD2, Kd_BRD4, Kd_BRDT) / Kd_BRD3`, using only untagged Boltz2 Exact coordinates with matched saved DeltaForge scores and the same scorer calibration. Include the nine highest-ranked candidates and AP2-9 separately as the control.

The panel contains **5 RFD3, 2 LigandForge, 1 AP Novo and 1 collaborator candidate, plus AP2-9**. These are design origins. Boltz2 Exact, AlphaFold 3, OpenDDE Exact and OpenFold are separate refolding methods; no candidate is assigned to only one of them.

This is a ranking within the user's edited shortlist, not a search of the entire design pool. Only four of the nine candidates exceed the historical provisional 10× predicted selectivity criterion. The remaining five are weaker-selectivity candidates/comparators. AP2-9 is a requested positive control whose archived role is a historical reference; its experimental positive-control status still needs verification.

## Structures and scope

Choose each sequence in the interface and select:

- Untagged or the full documented 64-residue tag.
- Boltz2 Exact, AlphaFold 3, OpenDDE Exact or OpenFold.
- Binder monomer, or complex with BRD3, BRD2, BRD4 or BRDT ET.

The publication manifest reports the actual available structures and any missing cells. The completed snapshot contains **400 of 400 comparisons**, including all eight validated AP2-9 OpenFold complexes. Both monomers and all four complex methods are available for every sequence and construct. Each comparison bundles its selected native model; additional native ensemble members remain in the original research archive.

All displayed affinities and selectivities are predictions. Tagged and untagged models and their scores remain separate. DeltaForge is **saved-scores-only**: the tagged panels for RFD3 1933 and C-34 have no saved Kds. A completed structure does not create a new Kd or establish biological function.

## Public snapshot

Everything under `docs/` is intentionally public. It contains only this selected panel and its referenced scientific assets, not the private multi-project workspace, raw provider responses, credentials, machine bindings or source-host paths. The original source hashes are retained. Original runs, failed attempts and underlying scientific outputs remain unchanged.

Use **Download PSE** beside the 3D viewer to open the currently selected method, construct and monomer/isoform model in PyMOL. Sessions are standalone, use the project colors, and retain the exact full chains. For an overlay, the button downloads the primary selected model. Every generated session was reopened and checked against its native atom count and chain sequences.

Use **Download coordinates** to save the exact native structure. **Center on
binder** or **Center on residue** changes the rotation center while keeping the
current zoom and orientation. Click a highlighted residue again to clear it.
**Side chains** includes alanine methyls.

The site opens directly as a single campaign. **Final Review** links to the selection and both complete FASTA files. **Looks good** can be undone or replaced with a follow-up. Package confirmation requires current reviews for all ten designs and validated publication of the requested model scope; an early attempt explains what remains.

**Request follow-up** saves a browser-local note. **Send follow-up on GitHub** opens an issue with exact candidate, sequence and selected-model context. Sign in and submit that form to send it to the shared queue. Submitted `[Follow-up]` issues are checked every two minutes by a private notification bridge, which sends the campaign owner a phone alert through the existing Fleet route. Delivery depends on that bridge and its credential-owning receiver being available. The queue is available for agent or researcher triage; it does not automatically start an AI session, calculations or paid scoring.

Reviews stay in each browser; use **Data & backups** to exchange review metadata. The public site needs no private service to view its bundled structures.

The **Binder dimers** tab is reserved for true two-chain binder homodimers: ten sequences × two constructs × five native methods (the four above plus ColabFold), with five native outputs per condition, or **500 coordinate files**. Each tagged copy retains its complete 64-residue tag. Choose any of the five native ranks to inspect its coordinates, ipTM/pTM and matching PSE download. Pending entries never use monomer/ET scores as substitutes. Dimer follow-ups include the exact selected native rank and coordinate hash.

The browser viewer and PSE downloads show canonical BRD3 hotspot positions mapped by full ET-sequence alignment onto each isoform and then onto its actual native residue numbers. Native coordinate files remain byte-for-byte unchanged.

## Verification and updates

```sh
python3 scripts/verify_review.py
python3 scripts/verify_jokent.py
python3 -m unittest discover -s tests
node --test tests/*.test.mjs
```

`build_review.py` is the project-owned publication adapter for the pinned Campaign Manager revision. It runs on the source host with its scientific validators, checks full coordinate sequences/chains, hashes, exact selection, saved score provenance and asset closure, and creates a new immutable output. It never launches predictions or scoring. Update the committed snapshot only after those checks pass. The Pages workflow verifies the prebuilt package and deploys only `docs/`.

UI-only refreshes use `python3 scripts/refresh_ui.py --app-root /path/to/Design_Campaign_Manager`. They preserve the published workspace and all scientific assets, record the UI commit separately, and reuse that presentation for later verified result publications.

The shared **kD predictions** view compares model-bound saved DeltaForge/PCANN values and exports exact PCANN run or DeltaForge quote requests. Execute requests from a trusted source checkout with its retained native inputs and saved provider receipts; the public site does not submit scientific jobs or authorize spending.

**More → Design from hotspots** reviews exact native target residues/atoms and prepares RFD3/RFD4/LigandForge requests for the owning scientific repository. Download the capsule or copy the complete issue text into its GitHub issue form. This static site provides manual issue creation; the owning scientific repository’s external preparation listener performs pickup and human review. Requests do not launch jobs or authorize spending.
