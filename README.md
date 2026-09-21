# HA3D

HA3D transforma um modelo `.glb` em uma interface 3D genérica para Home Assistant.

A meta do projeto é simples: instalar o HA3D, subir um GLB e vincular objetos do modelo às entidades do Home Assistant sem editar HTML específico para cada casa.

## Estado atual

A branch de desenvolvimento do app já contém um primeiro MVP instalável como custom integration:

- integração `custom_components/ha3d` com Config Flow;
- painel **HA3D** na barra lateral do Home Assistant;
- upload autenticado de um único arquivo `.glb`;
- armazenamento do modelo em `/config/www/ha3d/models/model.glb`;
- configuração persistente em `.storage`;
- viewer Three.js fullscreen;
- OrbitControls para mouse/toque;
- enquadramento automático do modelo;
- auto-binding por nome de objeto;
- picking/raycasting;
- controle `homeassistant.toggle` para `light`, `switch`, `input_boolean` e `fan`;
- suporte a bindings explícitos no backend.

O backup do viewer funcional original continua isolado em `backup/apto3d-original/` e não é alterado pelo novo app.

## Convenção do GLB

O modo mais simples é dar ao objeto 3D exatamente o mesmo nome da entidade no Home Assistant.

Exemplos:

```text
light.luz_da_sala
light.luz_do_escritorio
switch.impressora_3d
media_player.tv_sala
binary_sensor.janela_esquerda
vacuum.xiaomi_robot_vacuum_h50
```

Quando `auto_bind` está ativo, HA3D procura esses nomes em `hass.states` e cria os vínculos automaticamente.

Também existe suporte a um mapa explícito de bindings:

```json
{
  "Lamp_Sala": "light.luz_da_sala",
  "Printer": "switch.impressora_3d"
}
```

O editor visual desse mapa será a próxima etapa.

## Instalação de desenvolvimento

Copie `custom_components/ha3d/` para:

```text
/config/custom_components/ha3d/
```

Reinicie o Home Assistant e adicione **HA3D** em:

```text
Configurações → Dispositivos e serviços → Adicionar integração
```

Depois abra **HA3D** na barra lateral e use **Subir GLB**.

## Segurança

- upload exige usuário administrador;
- somente `.glb` é aceito;
- o arquivo é salvo sempre em um caminho fixo;
- não existe escrita genérica em `/config`;
- o upload tem limite de 250 MB;
- o GLB é validado pelo magic header `glTF` antes de substituir o modelo atual.

## Arquitetura

```text
custom_components/ha3d/
├── __init__.py          # lifecycle, painel e rotas
├── config_flow.py       # instalação pela UI
├── const.py
├── http.py              # config + upload GLB
├── storage.py           # bindings/config persistentes
├── manifest.json
├── strings.json
├── translations/
└── frontend/
    └── ha3d-panel.js    # viewer e integração com hass
```

## Versão de teste: Editor + Easy Floorplan concepts

Na branch `experimental/easy-floorplan-test` há uma versão de teste que mantém o
renderer Three.js/GLB e acrescenta, para administradores:

- **Editor Mode**: seleção e arraste de objetos do GLB no plano da câmera. O GLB
  nunca é modificado; posição, rotação e escala são persistidas separadamente.
- **HA Areas**: associação de um objeto a uma Area e botão para descobrir e
  adicionar as entidades registradas naquela Area como marcadores.
- **Binding avançado**: entidade principal, leituras extras, regras de estado
  para cor/ícone e visibilidade somente quando a câmera está próxima.
- **Ações Lovelace-like**: toque, toque longo e toque duplo, com `more-info`,
  `toggle`, `call-service` e `perform-action` suportados no formato armazenado.
  O comportamento padrão é conservador: só luzes, switches, ventiladores e
  input_booleans alternam no toque; os demais abrem More Info.
- Estados `unavailable` e `unknown` ficam acinzentados e explicitamente
  identificados. O clique recebe uma animação sutil, mas a aparência de estado
  só é atualizada pelos estados efetivamente recebidos do Home Assistant.

## Robôs no cenário 3D

A versão de teste inclui um menu **Robôs** independente dos bindings comuns.
Cada robô combina uma entidade `vacuum.*` (estado) com uma entidade de posição
que exponha `x`, `y` e `a`/`heading` — como os sensores do Xiaomi Cloud Map
Extractor. Também aceita esses valores como JSON no estado ou dentro de
`vacuum_position`/`position`.

1. Abra **Robôs → Adicionar robô** e escolha as duas entidades.
2. Escolha o ícone 3D padrão ou, no **Editor**, selecione um objeto do GLB e use
   **Usar objeto selecionado**.
3. Com o robô parado num local conhecido, clique em **Capturar A**, arraste a
   esfera laranja pelo cenário usando a tríade do Editor e clique em **Salvar A**.
4. Repita num segundo local, distante do primeiro, com o ponto B roxo.

O HA3D calcula escala, rotação e deslocamento. Há ajustes para trocar/inverter
eixos, altura, direção do modelo, suavização e tempo máximo para uma posição.
Quando a posição fica antiga ou indisponível, o robô é ocultado em vez de ser
movido para uma posição inventada.

Os conceitos de UX foram inspirados pelo Easy Floorplan, sob MIT. Veja `NOTICE`.
Não há renderer SVG, código ou assets do projeto incorporados ao HA3D.

## Próximas etapas

1. editor visual objeto ↔ entidade;
2. efeitos visuais por estado `on/off/unavailable`;
3. presets por domínio (luz, TV, porta, janela, vacuum, climate etc.);
4. posição e animação do robô;
5. empacotar Three.js localmente para funcionamento totalmente offline;
6. testes automatizados e validação HACS/hassfest;
7. releases versionadas para instalação direta pelo HACS.

## Base standalone

A base antiga em `index.html`, `src/` e `models/` continua no repositório por enquanto como laboratório do viewer. A implementação principal passará gradualmente para `custom_components/ha3d/`.
