# HA3D

Viewer Three.js genérico para Home Assistant, instalado pelo HACS como **Integration**.

## Atualização e caminho realmente carregado

O HACS instala somente `custom_components/ha3d/` em
`/config/custom_components/ha3d/`. O painel da barra lateral **HA3D** abre
`/ha3d` e carrega `/ha3d_static/ha3d-entry.js`, servido dessa pasta.
Não usa `index.html`, `src/` nem os HTMLs em `backup/` ou `/local/apto3d/`.

Cadeia de módulos:
`entry → graphics → ui → cinematic → panel → bindings + lighting`;
`entry` também carrega `scene`. Todos os imports internos recebem a mesma
versão `20260919-3`. A rota estática já está registrada com
`cache_headers=False`. A versão carregada aparece no status e no atributo
`data-ha3d-version` do painel.

1. HACS → HA3D → **Redownload** da branch `main`.
2. Se o HACS já tiver consultado o novo commit, **Update** também pode aparecer.
3. Recarregue a página inteira (ou feche/reabra a tela no aplicativo); navegar
   apenas entre painéis não recarrega os módulos JavaScript da sessão.
4. Abra **HA3D** na barra lateral, caminho `/ha3d`.

Esta alteração é somente de frontend: na instalação existente com
`ha3d-entry.js`, não é necessário reiniciar o Home Assistant.
Na primeira instalação da integração, reinicie uma vez e adicione HA3D em
Configurações → Dispositivos e serviços.

O projeto ainda não publica releases; o HACS acompanha commits da branch.
O `manifest.json` mantém a versão do backend (0.1.9); o frontend possui
seu identificador próprio. Ao editar módulos futuramente, atualize o token de
todos os imports internos e o teste de versionamento juntos.

## GLB → entidades

Nomeie um nó exatamente como um `entity_id` existente, por exemplo:

```text
light.example
media_player.example
switch.example
vacuum.example
climate.example
binary_sensor.example
```

Um nó `LightNode_light.example` ou `LightNode_media_player.example` pertence
ao mesmo dispositivo. O objeto comum ancora o marcador; as luzes exportadas
dentro dos nós associados fornecem a iluminação. Várias luzes por entidade são
sincronizadas juntas. Um objeto sem luz exportada recebe marcador, sem inventar
uma luz física.

O nome original do glTF é preservado para o binding: GLTFLoader pode remover
pontos ou acrescentar sufixos em `Object3D.name`. O vínculo não depende disso,
de palavras do nome, de friendly_name nem de tabelas de uma casa.

Entidades que ainda não chegaram a `hass.states` ficam pendentes e resolvem
quando HA publica novos estados. Luzes de candidatos pendentes ficam apagadas.
Ao desaparecer uma entidade já vinculada, seu marcador fica indisponível e
todas as luzes associadas apagam. Os bindings explícitos existentes na API
continuam funcionando, inclusive quando `auto_bind` está desativado.

## Marcadores e estado

Todos os domínios usam o mesmo botão circular de 34 px das lâmpadas, seguindo a
câmera e abrindo o more-info nativo do HA. O interior contém um `ha-icon`, sem
rótulos de texto. Prioridade: `attributes.icon` → `device_class` → domínio →
ícone genérico. Impressora 3D e Xbox usam, por exemplo, seus ícones configurados
no HA; não se inferem tipos pelo nome da entidade. Títulos acessíveis continuam
disponíveis para leitores de tela.

Luzes em `on` seguem brightness e cor; brilho zero permanece zero.
`off`, `unknown`, `unavailable` e ausência apagam a iluminação.
Media players só emitem nos estados `on/playing/paused/idle`; o simples fato
de existir não indica que estão ligados. Vacuum, climate, cover e demais
domínios possuem interpretação explícita do estado visual.

`assumed_state: true` mantém o estado reportado no marcador com borda
tracejada, mas não autoriza emissão física. Opcionalmente configure nos extras
do nó GLB (objeto `ha3d`) outra fonte confiável:

```json
{
  "ha3d": {
    "state_entity": "binary_sensor.confirmed_power",
    "direction": [0, 0, -1],
    "distance": 3
  }
}
```

`state_entity` altera só a fonte da iluminação; o marcador e more-info continuam
representando o dispositivo. Essa opção usa extras do GLB; não há editor visual
dessa configuração nesta versão.

## Iluminação e desempenho

- TV identificada por `device_class: tv` ou ícone de televisão usa SpotLight,
  orientada pelo eixo local **-Z** do nó da luz, conforme glTF. Um vetor
  `ha3d.direction` pode orientar outra fonte local. A frente física da TV
  deve coincidir com essa orientação no modelo; não é deduzida do nome.
- PointLights de teto permanecem omnidirecionais, com sombras e alcance finito.
  O alcance exportado é respeitado até 30 m; sem alcance, usa 6 m
  (TV: 3 m). `ha3d.distance` permite definir metros explicitamente.
- Paredes finas recebem sombras dos dois lados (`shadowSide`), sem alterar o
  lado visível do material. Paredes precisam existir na geometria.
- Sombras estáticas: 256 px em dispositivos de toque e 512 px em desktop,
  bias -0.0001, normalBias 0.01, near 0.02 m e far conforme alcance.
  Brilho/cor e câmera não recalculam sombras. Modelos animados exigiriam
  invalidação adicional, ainda não implementada.
- Limite de 24 faces de sombra em dispositivos de toque e 48 em desktop.
  Uma PointLight custa 6 faces; SpotLight custa 1. Portanto, até 4/8
  PointLights simultâneas quando não há spots. Dispositivos e spots têm
  prioridade sobre iluminação decorativa. A luz direcional geral usa um
  mapa adicional de 512 px.
- **Ao exceder o limite, fontes físicas excedentes ficam temporariamente
  apagadas, nunca acesas sem sombra. Seus marcadores continuam refletindo HA.**
  A contagem aparece no indicador do desktop. Não há promessa de exibir
  iluminação física ilimitada simultaneamente no iPhone.
- Mapas de sombra desligados são liberados, luzes inativas são retiradas do
  cálculo de iluminação, e trocar o GLB libera recursos do modelo anterior.
  O controle de qualidade de texturas existente é preservado.

Sombras não removem iluminação já gravada em lightmaps/emissive do GLB.
Essa iluminação precisa ser corrigida no modelo se aparecer como vazamento.

## Testes

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Os testes usam Microsoft Edge instalado e Three.js 0.180.0 local, sem depender
do CDN. Exercitam o GLB real (exportação + GLTFLoader), nomes originais,
resolução tardia, múltiplas luzes, estados, símbolos, more-info, fontes de estado
e orçamento de sombras. Testes WebGL comparam pixels com/sem uma parede para
PointLight e TV, verificando bloqueio e emissão somente para frente.
Isso não substitui o teste do GLB do usuário em Safari/iPhone.

## Arquivos e segurança

O GLB enviado pelo painel continua em `/config/www/ha3d/models/model.glb`.
Upload exige administrador, aceita GLB e mantém destino fixo e limite de 250 MB.
Configuração persiste pela API/store da integração; não se edita `.storage`.

Os arquivos `index.html` e `src/` são a base standalone antiga, fora do HACS.
`backup/apto3d-original/` preserva o viewer original.
