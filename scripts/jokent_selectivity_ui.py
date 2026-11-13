"""Apply the Jokent-only presentation for saved predicted selectivity."""
from pathlib import Path

def adapt_selectivity_ui(destination):
 destination=Path(destination)
 (destination/'predicted-selectivity.mjs').write_bytes(Path(__file__).with_name('predicted-selectivity.mjs').read_bytes())
 p=destination/'candidate-explorer.mjs';text=p.read_text();marker='  return `${publicScoreTable('
 assert text.count(marker)==1
 text="import {renderPredictedSelectivityTable} from './predicted-selectivity.mjs';\n"+text.replace(marker,'  return `${renderPredictedSelectivityTable(c)}${publicScoreTable(',1);p.write_text(text)
 p=destination/'selectivity.mjs';text=p.read_text();marker='  return `<section class="selectivity-panel"'
 assert text.count(marker)==1
 text="import {renderCandidatePredictedSelectivity} from './predicted-selectivity.mjs';\n"+text.replace(marker,'  return `${renderCandidatePredictedSelectivity(subject)}<section class="selectivity-panel"',1);p.write_text(text)
 (destination/'predicted-selectivity-page.mjs').write_text("import{renderPredictedSelectivityTable}from './predicted-selectivity.mjs';const w=await(await fetch('./data/local-workspace.json')).json();document.getElementById('predicted-selectivity-summary').innerHTML=renderPredictedSelectivityTable(w.campaigns[0]);\n")
 p=destination/'status.html';text=p.read_text().replace('<h2>Requested conditions</h2>','<section id="predicted-selectivity-summary"></section><script type="module" src="./predicted-selectivity-page.mjs"></script><h2>Requested conditions</h2>');p.write_text(text)
