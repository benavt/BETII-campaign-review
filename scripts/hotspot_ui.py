"""Thin static presentation adapter for shared hotspot request composition."""
import re


def once(text, old, new):
    if text.count(old) != 1: raise ValueError('Public hotspot adapter no longer matches: '+old[:70])
    return text.replace(old, new, 1)


def adapt_hotspots(app, source):
    shared=(source/'app.js').read_text()
    if "from './hotspot-design.mjs'" not in app:
        app="import {renderHotspotDesign,mountHotspotDesign,hotspotTargets} from './hotspot-design.mjs';\nlet hotspotController=null;const pendingHotspotTargets=new Map();\n"+app
    if "tab==='hotspot-design'?renderHotspotDesign()" not in app:
        app=once(app,"tab==='affinity'?renderAffinity", "tab==='hotspot-design'?renderHotspotDesign():tab==='affinity'?renderAffinity")
    if 'hotspotController?.dispose()' not in app:
        app=once(app,'inputController?.dispose();inputController=null;', 'hotspotController?.dispose();hotspotController=null;inputController?.dispose();inputController=null;')
    if "if(tab==='hotspot-design')mountHotspotPage" not in app:
        app=once(app,"  if(tab==='inputs')mountInputs(c,version);", "  if(tab==='hotspot-design')mountHotspotPage(c,version);\n  if(tab==='inputs')mountInputs(c,version);")
    if 'async function mountHotspotPage(' not in app:
        start=shared.index('async function mountHotspotPage(');end=shared.index('\nfunction mountInputs(',start)
        # Static runtime has no connected bridge; callbacks remain explicitly null.
        code=shared[start:end].replace("const connected=mode==='cache'&&runnerRuntime?.csrfToken;",'const connected=false;')
        app=once(app,'function mountInputs(c,version){',code+'\nfunction mountInputs(c,version){')
    if 'data-design-from-input' not in app:
        line=next(l for l in shared.splitlines() if "document.querySelectorAll('[data-design-from-input]')" in l)
        app=once(app,'function bind(c) {\n','function bind(c) {\n'+line+'\n')
    if "if(d.jobKind==='design'){tab='hotspot-design'" not in app:
        marker="    if(d.jobKind==='design'){"
        if marker in app:
            start=app.index(marker);end=app.index('\n',start)
            app=app[:start]+"    if(d.jobKind==='design'){tab='hotspot-design';render();return;}"+app[end:]
    app=app.replace("['affinity','overview','inputs','review-plan','evidence','review','colors','workspace','monomers','models','dimers']", "['hotspot-design','affinity','overview','inputs','review-plan','evidence','review','colors','workspace','monomers','models','dimers']")
    app=app.replace("'viewPreferences','molecularViewDefaults','modelSelections'];", "'viewPreferences','molecularViewDefaults','modelSelections','hotspotDesignDrafts','hotspotDesignRequests'];")
    app=app.replace("'viewPreferences','subjectReviews','modelSelections'])if", "'viewPreferences','subjectReviews','modelSelections','hotspotDesignDrafts','hotspotDesignRequests'])if")
    return app


def adapt_molecule(current, source):
    # Keep the public site's dimer, palette and annotation behavior. Refresh only
    # the shared source-bound selection methods used by the new composer.
    catalog=next(l for l in source.splitlines() if '    getAtomCatalog()' in l)
    if '    getAtomCatalog()' not in current:
        current=once(current,'    ready, setSpecies, setVisibleModels,','    ready, setSpecies, setVisibleModels,\n'+catalog)
    else:
        current=re.sub(r'^    getAtomCatalog\(\).*$',lambda _:catalog,current,flags=re.M)
    start=source.index('    setPickedResidues(selectors)');end=source.index('\n    reset()',start)
    old_start=current.index('    setPickedResidues(selectors)');old_end=current.index('\n    reset()',old_start)
    return current[:old_start]+source[start:end]+current[old_end:]
