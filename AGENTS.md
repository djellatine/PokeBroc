<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Livrer

Dès qu'une fonctionnalité, une correction ou un refactor est terminé et tient
debout, invoquer la skill `livrer` (`.claude/skills/livrer/SKILL.md`) : elle
vérifie, commite et pousse sur `main`. Sans attendre que l'utilisateur le
demande — mais après lui avoir montré le résultat, jamais au milieu d'un travail
en cours.
