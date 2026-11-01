"""Static-only adapter for the pinned Campaign Manager UI."""
import re

def require(ok,message):
    if not ok:raise ValueError(message)

def replace_once(text, old, new):
    require(text.count(old) == 1, 'Upstream static adapter no longer matches: ' + old[:70])
    return text.replace(old, new)

def adapt_app(raw, workspace_hash):
    text = raw.decode()
    replacements = [
        ("const forceDemo=new URL(location.href).searchParams.get('demo')==='1';", 'const forceDemo=false;'),
        ("const key=forceDemo?'campaign-studio-demo-v1':'campaign-studio-v1';", "const key='betii-static-" + workspace_hash + "';"),
        ('runnerRuntime=forceDemo?null:await runtimeInfo();', 'runnerRuntime=null;'),
        ("if(!forceDemo&&mode!=='imported'&&(runnerRuntime?.privateWorkspaceAvailable===true||['localhost','127.0.0.1','[::1]'].includes(location.hostname))){", "if(mode!=='imported'){"),
        ("catch(error){notify('Private campaign data could not be opened: '+error.message);}", "catch(error){throw new Error('The BETII snapshot could not be opened: '+error.message);}"),
        ("The private workspace is unavailable. Check that the Mac service is online.", 'The bundled BETII snapshot is unavailable. Reload the site or contact its maintainer.'),
        ("Connecting to the private campaign service…", 'Opening the saved BETII snapshot…'),
        ("const refoldEnabled=c=>Boolean(c.selectionDraft&&c.candidatePool&&c.id.startsWith('betii-'));", 'const refoldEnabled=c=>false;'),
    ]
    for old, new in replacements:
        text = replace_once(text, old, new)
    return text.encode()

def adapt_shell(raw):
    text = raw.decode()
    start = text.index('  const connection=')
    end = text.index('\n', start)
    text = text[:start] + "  const connection='Saved BETII snapshot · reviews stay in this browser';" + text[end:]
    text = text.replace("'Private campaign data'", "'BETII review snapshot'")
    text = text.replace('A static preview serves the same interface with illustrative data. An imported workspace contains saved metadata and references; referenced structures may need the original private server to be available.', 'This static site bundles recorded BETII metadata and its referenced molecular structures. It runs no scientific jobs. Review changes can be exported and imported between browsers.')
    text, count = re.subn(r'<details class="workspace-sample">.*?</details>', '', text)
    require(count == 1, 'Upstream sample-link markup changed')
    return text.encode()
