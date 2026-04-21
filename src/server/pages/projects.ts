// Phase 10-PD: Projects management page
// Lists registered projects, discovered repos, and global AI capture status.

import { Hono } from "hono";
import { layout } from "./layout.js";

export const projectsPage = new Hono();

projectsPage.get("/projects", (c) => {
  const content = `
    <h1 class="font-heading text-2xl font-semibold mb-6">Projects</h1>

    <!-- Registered Projects -->
    <h2 class="font-heading text-lg font-semibold mb-3">Registered Projects</h2>
    <div id="project-cards" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <div class="text-sm text-muted py-4">Loading projects...</div>
    </div>

    <!-- Discovered Projects -->
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-heading text-lg font-semibold">Discovered Projects</h2>
      <button id="scan-btn" onclick="scanProjects()" class="text-xs px-3 py-1.5 rounded-md bg-raised border border-border text-foreground hover:bg-surface transition-colors">Scan for projects</button>
    </div>
    <div id="discovered-cards" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <div class="text-sm text-muted py-4">Click "Scan" to discover git repos...</div>
    </div>

    <!-- Add Manually -->
    <div class="mb-8">
      <div class="flex items-center gap-3">
        <input type="text" id="add-path" placeholder="Paste a project path, e.g. ~/IdeaProjects/my-app"
          class="flex-1 bg-surface border border-border rounded-lg px-4 py-2 text-sm text-foreground font-mono placeholder:text-muted focus:outline-none focus:border-accent/60">
        <button onclick="addProject()" class="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-dim transition-colors">Add Project</button>
      </div>
      <div id="add-feedback" class="text-xs mt-2 hidden"></div>
    </div>

    <!-- Global AI Capture -->
    <h2 class="font-heading text-lg font-semibold mb-3">Global AI Capture</h2>
    <div class="bg-surface border border-border rounded-lg p-4 mb-6">
      <div class="flex items-center gap-2 text-sm">
        <span class="w-2 h-2 rounded-full bg-success"></span>
        <span class="text-foreground">Running</span>
        <span class="text-muted">— Watching: ~/.claude/, Cursor, Codex, Aider</span>
      </div>
      <div class="text-xs text-muted mt-2">AI session events are captured globally and tagged with the matching project ID via registry lookup.</div>
    </div>

    <script>
    (function(){
      loadProjects();

      function loadProjects(){
        fetch('/api/projects').then(function(r){return r.json();}).then(function(data){
          var el=document.getElementById('project-cards');
          if(!data.projects||data.projects.length===0){
            el.innerHTML='<div class="text-sm text-muted col-span-3 py-4">No projects registered. Use the form below or run <code class="bg-raised px-1 rounded font-mono">unfade add &lt;path&gt;</code></div>';
            return;
          }
          el.innerHTML=data.projects.map(function(p){
            var statusDot=p.monitoring==='active'?'bg-success':'bg-warning';
            var statusLabel=p.monitoring==='active'?'Active':'Paused';
            var actionBtn=p.monitoring==='active'
              ?'<button onclick="pauseProject(\\'' +p.id+'\\',this)" class="text-xs px-2 py-1 rounded bg-raised border border-border text-muted hover:text-foreground">Pause</button>'
              :'<button onclick="resumeProject(\\'' +p.id+'\\',this)" class="text-xs px-2 py-1 rounded bg-raised border border-border text-muted hover:text-foreground">Resume</button>';
            var rootWarning=p.rootExists?'':'<div class="text-xs text-error mt-1">⚠ Path not found</div>';
            var badge=p.addedVia?'<span class="text-[10px] px-1 py-0.5 rounded bg-raised text-muted">'+p.addedVia+'</span>':'';
            return '<div class="bg-surface border border-border rounded-lg p-4">'
              +'<div class="flex items-center justify-between mb-2">'
              +'<span class="text-sm font-semibold text-foreground truncate">'+p.label+'</span>'
              +badge
              +'</div>'
              +'<div class="flex items-center gap-1.5 mb-2"><span class="w-2 h-2 rounded-full '+statusDot+'"></span><span class="text-xs text-muted">'+statusLabel+'</span></div>'
              +'<div class="text-xs text-muted font-mono truncate mb-2" title="'+p.root+'">'+p.root+'</div>'
              +rootWarning
              +'<div class="flex items-center gap-2 mt-3">'
              +actionBtn
              +'<button onclick="removeProject(\\'' +p.id+'\\',\\'' +p.label+'\\',this)" class="text-xs px-2 py-1 rounded text-error hover:bg-error/10">Remove</button>'
              +'</div></div>';
          }).join('');
        }).catch(function(){
          document.getElementById('project-cards').innerHTML='<div class="text-sm text-error">Failed to load projects</div>';
        });
      }

      window.scanProjects=function(){
        var btn=document.getElementById('scan-btn');
        btn.textContent='Scanning...';btn.disabled=true;
        fetch('/api/projects/discover').then(function(r){return r.json();}).then(function(data){
          btn.textContent='Scan for projects';btn.disabled=false;
          var el=document.getElementById('discovered-cards');
          if(!data.discovered||data.discovered.length===0){
            el.innerHTML='<div class="text-sm text-muted col-span-3 py-4">No new projects found. All git repos in your scan directories are already registered.</div>';
            return;
          }
          el.innerHTML=data.discovered.map(function(d){
            return '<div class="bg-surface border border-border rounded-lg p-4">'
              +'<div class="text-sm font-semibold text-foreground mb-1">'+d.label+'</div>'
              +'<div class="text-xs text-muted font-mono truncate mb-3" title="'+d.path+'">'+d.path+'</div>'
              +'<button onclick="addDiscovered(\\'' +d.path.replace(/'/g,"\\\\'")+'\\',this)" class="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-dim">+ Add</button>'
              +'</div>';
          }).join('');
        }).catch(function(){
          btn.textContent='Scan for projects';btn.disabled=false;
        });
      };

      window.addDiscovered=function(path,btn){
        btn.textContent='Adding...';btn.disabled=true;
        fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path,addedVia:'auto-discovery'})})
          .then(function(r){return r.json();})
          .then(function(){btn.textContent='Added ✓';btn.classList.add('bg-success');loadProjects();})
          .catch(function(){btn.textContent='Failed';btn.disabled=false;});
      };

      window.addProject=function(){
        var input=document.getElementById('add-path');
        var fb=document.getElementById('add-feedback');
        var path=input.value.trim().replace(/^~/,window.__unfade?'':process?.env?.HOME||'');
        if(!path){fb.textContent='Please enter a path';fb.className='text-xs mt-2 text-error';fb.classList.remove('hidden');return;}
        fb.classList.add('hidden');
        fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path,addedVia:'ui'})})
          .then(function(r){return r.json();})
          .then(function(data){
            if(data.error){fb.textContent=data.error;fb.className='text-xs mt-2 text-error';fb.classList.remove('hidden');return;}
            fb.textContent='Project added!';fb.className='text-xs mt-2 text-success';fb.classList.remove('hidden');
            input.value='';loadProjects();
          })
          .catch(function(){fb.textContent='Failed to add';fb.className='text-xs mt-2 text-error';fb.classList.remove('hidden');});
      };

      window.pauseProject=function(id,btn){
        btn.textContent='Pausing...';
        fetch('/api/projects/'+id+'/pause',{method:'POST'}).then(function(){loadProjects();});
      };

      window.resumeProject=function(id,btn){
        btn.textContent='Resuming...';
        fetch('/api/projects/'+id+'/resume',{method:'POST'}).then(function(){loadProjects();});
      };

      window.removeProject=function(id,label,btn){
        if(!confirm('Remove project "'+label+'"? This unregisters it from Unfade. Your code and data are not deleted.'))return;
        btn.textContent='Removing...';
        fetch('/api/projects/'+id,{method:'DELETE'}).then(function(){loadProjects();});
      };
    })();
    </script>
  `;

  return c.html(layout("Projects", content));
});
