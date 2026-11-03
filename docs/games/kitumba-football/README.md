<div align="center">

# Kitumba Football

<sub>[← Kitumba Games](../../../README.md) · rota <code>/football</code></sub>

**Futebol 11 contra 11 em 3D, num estádio neon à noite.**
Controlas a tua equipa inteira à maneira dos jogos de futebol para telemóvel: joystick para conduzir e botões de passe, remate, passe em profundidade e sprint que mudam de função quando defendes. Ganha o jogo e sobe de divisão; cada divisão traz um rival com outro equipamento, com reações mais rápidas e mais certeiro.

</div>

---

## Índice

1. [Capturas de ecrã](#capturas-de-ecrã)
2. [Como jogar](#como-jogar)
3. [Regras do jogo](#regras-do-jogo)
4. [Divisões e recorde](#divisões-e-recorde)
5. [Efeitos sonoros](#efeitos-sonoros)
6. [Arquitetura técnica](#arquitetura-técnica)
7. [Ajustar a jogabilidade](#ajustar-a-jogabilidade)

---

## Capturas de ecrã

<table>
  <tr>
    <td width="40%"><img src="screenshots/gameplay.png" alt="Em jogo, com os jogadores das duas equipas no estádio" /></td>
    <td width="40%"><img src="screenshots/gameover.png" alt="Ecrã de fim de jogo com o resultado" /></td>
    <td width="20%"><img src="screenshots/mobile-gameplay.png" alt="Em jogo no telemóvel, com joystick e botões de ação" /></td>
  </tr>
  <tr>
    <td align="center"><b>Em jogo</b><br/><sub>11 contra 11; controlas o jogador com o anel</sub></td>
    <td align="center"><b>Apito final</b><br/><sub>Resultado, vitórias seguidas e divisão</sub></td>
    <td align="center"><b>Telemóvel</b><br/><sub>Joystick e quatro botões de ação</sub></td>
  </tr>
</table>

---

## Como jogar

A tua equipa (ciano) ataca a **baliza do fundo do ecrã**. Controlas o jogador com o anel e a seta por cima da cabeça; a barra verde é a energia dele. Os outros dez, os guarda-redes e o rival são controlados pela IA.

| Ação | Teclado | Telemóvel / tátil |
|---|---|---|
| Correr / conduzir a bola | `↑` `↓` `←` `→` ou `W` `A` `S` `D` | Joystick |
| Sprint (gasta energia) | `Shift` (manter) | **SPRINT** (manter) |
| Com bola: passe · Sem bola: trocar de jogador | `Espaço` ou `J` | **PASSE** / **TROCAR** |
| Com bola: remate · Sem bola: carrinho | `K` ou `X` (manter para carregar) | **REMATE** / **CARRINHO** |
| Com bola: passe em profundidade · Sem bola: pressão de um colega | `L` ou `C` | **EM PROF.** / **PRESSÃO** |
| Começar / próximo jogo | `Enter` ou `Espaço` | **Apito inicial** / **Próximo jogo** |
| Pausar / retomar | `P` ou `Esc` | `❚❚` / `▶` |
| Som | `M` | **Som** |

- **Passe**: vai para o colega na direção do joystick, pesando a linha de passe livre e a marcação. **Sem joystick**, escolhe a opção segura que mais faz avançar a equipa (nunca um passe para trás por engano). Passes de mais de 26 m vão pelo ar. O controlo passa logo para quem recebe, que corre para a bola sozinho até mexeres no joystick.
- **Receção**: com o joystick inclinado quando a bola chega, a primeira receção já sai orientada para esse lado. Passes muito fortes fogem um pouco mais do pé — sempre da mesma forma para a mesma força.
- **Condução**: em sprint a bola vai mais à frente — é mais rápido, mas mais fácil de roubar. Quem tem a bola protege-a com o corpo: desarmar por trás resulta metade das vezes.
- **Remate**: manter carrega a força (barra por cima do jogador). A zona verde da barra é a mais certeira; a vermelha é força a mais e sai torto ou por cima. O joystick para os lados escolhe o canto; para a frente remata rasteiro, para trás faz um chapéu. A precisão piora com pressão de um defesa, velocidade, corpo mal virado para a baliza, pé mais fraco e distância.
- **Defender**: toque em **TROCAR** muda para o colega mais bem posicionado (perto e do lado da tua baliza). **Manter** o mesmo botão faz o jogador **conter**: acompanha o adversário de frente, entre ele e a baliza, sem se atirar. **CARRINHO** ganha a bola se lhe chegar, mas depois ficas no chão uns instantes. **PRESSÃO** (manter) manda um colega pressionar.
- **Botões cedo de mais**: um passe ou remate carregado um instante antes de a bola chegar (ou antes do apito do pontapé de saída) fica guardado e sai assim que puder.
- **Bolas paradas**: lançamentos, cantos e pontapés de saída esperam por ti — aponta com o joystick e passa. No canto, **REMATE** cruza para a área.
- **Telemóvel**: joystick analógico (com zona morta) e os botões funcionam ao mesmo tempo com dois dedos. Na horizontal, o campo ocupa o ecrã inteiro com os controlos por cima; na vertical ficam por baixo do campo. Em telemóveis compatíveis, golos, remates e desarmes dão uma vibração curta (desliga com o som).

---

## Regras do jogo

Valores em `GAMEPLAY_CONFIG`, em [src/games/football/config.ts](../../../src/games/football/config.ts). A unidade é o metro.

- Campo de 52 × 80 m, baliza de 7,6 × 2,44 m. 4-4-2 para as duas equipas.
- Cada jogo dura **180 s** reais (90 minutos no HUD), com um ecrã de **intervalo** aos 45' (resultado e posse de bola) e pontapé de saída do CPU na 2.ª parte.
- Há **lançamentos, cantos e pontapés de baliza**. Não há foras de jogo nem faltas.
- A bola tem altura e gravidade: passes pelo ar passam por cima dos defesas, remates podem ir à barra ou por cima, e há **postes** e **barra**.
- Bolas rápidas podem ressaltar de quem tenta controlá-las, a não ser que sejam para ele.
- Os guarda-redes cortam o ângulo e só reagem a um remate depois de um tempo de reação (0,12 s o teu; o do CPU começa em 0,26 s e melhora com a divisão). **Mergulham** a remates fora do alcance, agarram ou desviam **para o lado** (nunca para o meio da área), e saem a bolas soltas na área. Depois de agarrar, repõem com um passe para um colega livre.
- No fim aparece a **posse de bola** de cada equipa.

---

## Divisões e recorde

| Resultado | Efeito |
|---|---|
| Vitória | +1 vitória seguida e sobes uma divisão |
| Empate | Ficas na mesma divisão; a série mantém-se |
| Derrota | A série volta a 0 e voltas à divisão 1 |

Cada divisão acima da 1 dá ao CPU melhores reações e precisão, não velocidade a mais: passes e remates mais certeiros, desarmes mais eficazes (até 52%), um guarda-redes que reage mais cedo e defende mais, e a partir da 3.ª divisão um segundo jogador a fazer cobertura atrás de quem pressiona. A velocidade só sobe 1% por divisão, até 100%. O rival muda de equipamento a cada divisão.

O **recorde** é a maior série de vitórias seguidas. Fica no `localStorage`, na chave `kitumba-football:best`.


---

## Efeitos sonoros

Todos os sons são sintetizados com a Web Audio API em [src/games/football/audio.ts](../../../src/games/football/audio.ts). Não há ficheiros de áudio.

| Evento | Som | Efeito visual |
|---|---|---|
| Público (contínuo) | Ruído filtrado baixinho, tipo murmúrio de estádio | — |
| Apito inicial / recomeço | Apito de árbitro (seno agudo com trilo rápido) | "PONTAPÉ DE SAÍDA" |
| Chuto | Pancada grave e estalo; mais forte quanto mais forte o chuto | Faísca na cor da equipa (só remates) |
| Chuto falhado | "Swish" de ar | — |
| Ressalto na linha | Toque grave curto | — |
| Poste | Três tons metálicos e um "uh" do público | Ecrã treme um pouco |
| Golo teu | Rugido do público a subir e fanfarra | "GOLO!", confetti, flash ciano; o marcador corre para a bandeirola e a equipa festeja |
| Golo do CPU | Lamento do público e notas a descer | "GOLO CPU", flash magenta |
| Defesa / carrinho | Mãos na bola e "uh" do público / "swish" | "DEFESA!" / "CARRINHO!" |
| Apito final | Três apitos | Painel de resultado |
| Vitória | Fanfarra depois do apito final | — |
| Pausa | Duas notas descendentes | Painel de pausa |

O público cala-se na pausa, no fim do jogo e ao sair da página.

---

## Arquitetura técnica

```
src/games/football/
├── FootballPage.tsx  # Página /football: HUD em HTML, painéis, teclado, joystick e botões táteis
├── config.ts         # GAMEPLAY_CONFIG: todos os valores de jogabilidade, com unidades
├── engine.ts         # Simulação (bola, posse, IA, guarda-redes), câmara, overlay e qualidade gráfica
├── humanoid.ts       # Jogador 3D articulado e as suas poses, com transições suaves
├── stadium.ts        # Relvado, marcações, balizas com rede, placas, bancadas e torres de luz
├── audio.ts          # Público, apito e efeitos sintetizados
└── assets/           # Do pacote de assets: relva, bola, sombra, marcador, joystick, botões e ícones
```

- **`FootballGame` (engine.ts)** não depende do React. Recebe o `<canvas>` WebGL, um `<canvas>` 2D por cima (radar, barra de remate, letreiros, confetti) e uma callback `onChange(hud)`:

  | Método | Descrição |
  |---|---|
  | `start()` | Começa um jogo na divisão atual |
  | `togglePause()` | Alterna entre `playing` ↔ `paused` (e larga todos os botões) |
  | `resume()` | Começa a 2.ª parte a partir do intervalo |
  | `setInput(x, y)` | Vetor de movimento, limitado ao círculo unitário (diagonais não são mais rápidas) |
  | `press(action, down)` | Botão `pass`, `shoot`, `through` ou `sprint` carregado ou largado |
  | `destroy()` | Pára o loop, os listeners e o público, e liberta a cena |

- **Simulação**: passo fixo de 1/120 s com acumulador e no máximo 12 passos por frame; depois de um separador escondido ou de um engasgo, o atraso é descartado em vez de acelerar o jogo. O jogo pausa sozinho quando o separador fica escondido.
- **Estados da bola**: com dono, agarrada pelo guarda-redes, parada (bola parada), passe, remate, no ar ou solta. A posse é exclusiva e não pode mudar outra vez nos 0,35 s seguintes.
- **Movimento**: aceleração, travagem e mudança de direção têm taxas separadas (`player.accel`, `brake`, `turn`).
- **IA**: a decisão do jogador com bola (`decideOwner`) é separada da execução. A equipa mantém o 4-4-2 deslocado com a bola; laterais sobem pelo lado da bola, extremos abrem, um jogador pressiona e outro faz cobertura, os colegas do portador afastam-se para dar linha de passe. Cada jogador tem um ritmo próprio fixo (`quirk`) para não se moverem todos ao mesmo tempo.
- **Troca automática** de jogador com histerese (só se outro estiver 4 m melhor) e no mínimo 0,6 s entre trocas.
- **Qualidade**: em ecrãs táteis começa com resolução 1,5×; se os frames ficarem lentos (média acima de 24 ms durante 2 s), baixa a resolução e depois desliga as sombras. Os controlos nunca são afetados.
- **HUD**: em HTML, só é enviado ao React quando muda (energia em passos de 5%).
- Em desenvolvimento, `window.__football` dá acesso ao jogo para testes no browser; não existe na build de produção.

---

## Ajustar a jogabilidade

Tudo está em `GAMEPLAY_CONFIG` em [src/games/football/config.ts](../../../src/games/football/config.ts), agrupado por tema e com as unidades em comentário:

| Grupo | O que controla |
|---|---|
| `pitch` | Dimensões do campo, baliza e áreas |
| `player` | Velocidades, aceleração / travagem / viragem, rotação, passada |
| `stamina` | Gasto em sprint, recuperação, limiar de cansaço |
| `ball` | Gravidade, atrito no chão e no ar, ressalto |
| `control` | Raio de domínio, bolas "quentes", bloqueio de posse, toques na condução, buffer de input |
| `pass` | Velocidades, passe pelo ar, cone de seleção, passe em profundidade |
| `shot` | Carga, curva de potência, zona ótima, fontes de imprecisão |
| `tackle` | Alcance, probabilidades, carrinho |
| `switching` | Histerese e intervalo da troca automática, conter |
| `ai` | Ritmo, desarme e precisão do CPU por divisão (`[divisão 1, passo, limite]`) |
| `keeper` | Mergulho, alcance, tempo de reação e defesa |
| `match` | Duração, pausas, passo da simulação |
| `camera` / `quality` | Enquadramento e degradação gráfica |
