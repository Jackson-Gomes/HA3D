# HA3D

Frontend 3D genérico para Home Assistant, independente do projeto APT0307.

## Estado atual

Primeira base funcional criada:

- viewer WebGL com Three.js;
- carregamento GLB/GLTF;
- OrbitControls para mouse/toque;
- enquadramento automático do modelo;
- raycasting/picking de objetos 3D;
- adapter separado para Home Assistant;
- layout fullscreen para TV/mobile;
- configuração central em `src/config.js`.

## Modelo

Coloque o modelo em:

`models/home.glb`

ou altere `model` em `src/config.js`.

## Home Assistant

Destino planejado:

`/config/www/ha3d/`

O projeto não modifica `/config/www/apto3d/` nem depende do APT0307.

## Próximas etapas

1. bindings objeto 3D ↔ entity_id;
2. estados em tempo real;
3. ligar/desligar entidades clicando no modelo;
4. painel de configuração;
5. otimizações específicas para TV/iOS;
6. posição do robô e overlays 3D.
