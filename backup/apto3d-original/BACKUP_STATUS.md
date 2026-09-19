# HA3D — backup da versão funcional atual

Origem somente-leitura: `/config/www/apto3d/`

Destino: `backup/apto3d-original/`

Data do levantamento: 2026-09-19

## Cadeia funcional identificada

1. `menu.CINEMATIC__TOP-FULLSCREEN-IOS-20260918.html`
2. `menu.CINEMATIC-V7-FOCUS-20260918.html`
3. `menu.CINEMATIC-20260918.html`
4. `index.ROBOTTEST-20260918.html`
5. `Main.glb`

O wrapper superior carrega o V7, o V7 carrega o viewer cinematográfico base, o viewer base injeta alterações sobre `index.ROBOTTEST-20260918.html`, e esse arquivo carrega `Main.glb`.

CSS e JavaScript dessa cadeia estão embutidos nos próprios HTMLs. Three.js, OrbitControls e GLTFLoader são carregados por CDN no `index.ROBOTTEST-20260918.html`.

## Estado desta cópia

Copiados com sucesso:

- `menu.CINEMATIC__TOP-FULLSCREEN-IOS-20260918.html`
- `menu.CINEMATIC-20260918.html`
- `index.ROBOTTEST-20260918.html`

Pendentes por limitações dos conectores usados nesta sessão:

- `menu.CINEMATIC-V7-FOCUS-20260918.html`: o arquivo foi lido integralmente e sem truncamento do Home Assistant, mas a operação de gravação foi recusada pelo conector do GitHub ao enviar esse conteúdo específico.
- `Main.glb`: o Home Assistant connector disponível lê somente UTF-8 e recusou o GLB por ser binário.
- listagem completa do diretório `/config/www/apto3d/`: o connector disponível não possui operação de listagem para `/config/www`; leitura de diretório foi recusada por não ser arquivo regular.

Nenhum arquivo da origem `/config/www/apto3d/` foi modificado durante este levantamento.

Este backup deve ser considerado **parcial** até os dois arquivos pendentes serem adicionados e a listagem integral do diretório de origem ser comparada com o conteúdo deste diretório.
