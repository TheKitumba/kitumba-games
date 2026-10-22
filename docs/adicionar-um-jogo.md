# Adicionar um jogo

Cada jogo é uma pasta em `src/games/` com uma página React por defeito. O router e o catálogo da página inicial são gerados a partir de uma única lista, por isso um jogo novo precisa de poucos passos.

## Como funcionam as rotas

```
src/
├── main.tsx              # Monta o RouterProvider
├── router.tsx            # createBrowserRouter: / → Home, /<slug> → jogo, * → 404
├── components/Layout.tsx # Cena synthwave partilhada + <Outlet /> + Suspense
├── pages/
│   ├── Home.tsx          # Catálogo de jogos (lê src/games/index.ts)
│   └── NotFound.tsx      # Página 404
└── games/
    ├── index.ts          # Registo de todos os jogos
    ├── snake/            # Kitumba Snake
    └── racer/            # Kitumba Racer
```

| Rota | Página |
|---|---|
| `/` | Catálogo de jogos |
| `/snake` | Kitumba Snake |
| `/racer` | Kitumba Racer |
| qualquer outra | 404 "Sinal perdido" |

O routing usa [React Router](https://reactrouter.com/) em modo browser (`createBrowserRouter`), com URLs limpos sem `#`.

## Passos

1. **Cria a pasta do jogo** em `src/games/<slug>/` com uma página que exporta um componente por defeito, por exemplo `src/games/tetris/TetrisPage.tsx`. A cena de fundo já vem do `Layout`, por isso a página só precisa de desenhar o seu conteúdo dentro de um `<main>`. Para o título do separador, põe um `<title>` dentro da página (o React 19 move-o para o `<head>`).

2. **Regista o jogo** em [src/games/index.ts](../src/games/index.ts):

   ```ts
   {
     slug: 'tetris',
     title: 'Kitumba Tetris',
     tagline: 'Blocos // 2099',
     description: 'Descrição curta que aparece no cartão da página inicial.',
     accent: 'from-amber-300 to-rose-500',
     tags: ['Puzzle', 'Teclado'],
     Component: lazy(() => import('./tetris/TetrisPage')),
   },
   ```

   Isto cria a rota `/tetris` e o cartão no catálogo. O `lazy` faz com que o código do jogo vá num ficheiro à parte, descarregado só quando alguém abre o jogo.

3. **Adiciona a rota ao sitemap** na lista `ROUTES` em [vite.config.ts](../vite.config.ts).

4. **Escreve a documentação** em `docs/games/<slug>/README.md` (capturas em `docs/games/<slug>/screenshots/`) e acrescenta uma linha à tabela em [docs/README.md](README.md) e no [README principal](../README.md).

5. **Liberta recursos ao sair da rota.** Quando o utilizador volta ao catálogo, a página é desmontada: o cleanup dos `useEffect` tem de parar o loop, a música e os listeners globais (`keydown`, `blur`…). O Kitumba Snake faz isto em `SnakeGame.destroy()`.

## Publicar com rotas

O build continua a ser 100% estático, mas como os URLs são reais (`/snake`), o alojamento tem de devolver o `index.html` para qualquer caminho que não seja um ficheiro. Sem isso, abrir `/snake` diretamente ou fazer refresh dá 404.

| Alojamento | Configuração |
|---|---|
| Netlify | ficheiro `public/_redirects` com `/*  /index.html  200` |
| Vercel | `vercel.json` com `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` |
| Cloudflare Pages | funciona sem configuração (fallback SPA automático) |
| GitHub Pages | não tem rewrites: copia `dist/index.html` para `dist/404.html` no build |

`pnpm dev` e `pnpm preview` já fazem este fallback localmente.
