# Flexbox + Scroll: Cómo hacer que un contenedor interno scrollee dentro de un card con altura máxima

## El escenario

Tenés un contenedor (card) con:
- Un header fijo
- Un body con contenido variable (tabla, lista, etc.)
- Una altura máxima (`max-height`)
- Querés que el body scrollee cuando el contenido supera el espacio disponible

## La estructura HTML

```html
<div class="card">          <!-- contenedor padre -->
  <div class="card-header">Título</div>
  <div class="card-body">   <!-- acá va el contenido que debe scrollear -->
    <table>...</table>
  </div>
</div>
```

## Lo que NO funciona

### Intento 1: Solo `flex: 1` + `overflow-y: auto` en el body

```css
.card {
  display: flex;
  flex-direction: column;
  max-height: 950px;
  overflow: hidden;
}
.card-header {
  /* sin flex-shrink: 0 */
}
.card-body {
  flex: 1;
  overflow-y: auto;
}
```

**Por qué falla**: Los items flex tienen `min-height: auto` por defecto. Esto significa que el body **nunca se achica más que su contenido**, así que nunca hay overflow y nunca aparece el scroll.

---

### Intento 2: Agregar `min-height: 0`

```css
.card-body {
  flex: 1;
  min-height: 0;  /* permite achicarse */
  overflow-y: auto;
}
```

**Por qué falla**: `min-height: 0` resuelve la mitad del problema, pero `max-height` en el padre **no es una altura definida** — es solo un límite. El flex item no recibe una restricción de altura concreta que le diga "esto es todo el espacio que tenés". El navegador calcula el height del body como el de su contenido, y el `overflow: hidden` del padre simplemente lo recorta visualmente sin activar el scroll del hijo.

---

### Intento 3: Sacar `overflow: hidden` del padre

```css
.card {
  display: flex;
  flex-direction: column;
  max-height: 950px;
  /* sin overflow: hidden */
}
.card-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

**Por qué falla**: Ahora el body sí podría scrollear, pero sin `overflow: hidden` en el padre, el contenido se escapa visualmente de los bordes del card (y pierde el `border-radius`).

---

## Lo que SÍ funciona

### La solución: `max-height` explícito con `calc()` en el body

```css
.card {
  display: flex;
  flex-direction: column;
  max-height: 950px;
  overflow: hidden;
}

.card-header {
  flex-shrink: 0;  /* el header nunca se achica */
}

.card-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-height: calc(950px - 55px);  /* altura máxima del card menos la altura del header */
}
```

**Por qué funciona**: Al poner un `max-height` directamente en el body con un valor `calc()`, el navegador tiene una **restricción de altura concreta** sobre el elemento que tiene `overflow-y: auto`. Ya no depende de que el padre le transmita la restricción — el body sabe exactamente cuánto espacio tiene y puede calcular si hay overflow.

## La regla general

> **Si un elemento flex necesita scrollear, dale una restricción de altura explícita (height o max-height) directamente en ese elemento, no confíes en que el padre flex se la propague.**

### Checklist para aplicar esto en cualquier caso:

1. **El padre** (card) debe ser `display: flex; flex-direction: column;` con `max-height` y `overflow: hidden`
2. **El header** debe tener `flex-shrink: 0` para que no se achique
3. **El body** debe tener:
   - `flex: 1` (ocupa el espacio restante)
   - `min-height: 0` (permite achicarse por debajo del contenido)
   - `overflow-y: auto` (muestra scroll cuando hay overflow)
   - `max-height: calc(altura-padre - altura-header)` ← **la clave**
4. Si usás `grid` para layout de múltiples cards, agregá `align-items: start` para que cada card tenga su propia altura (no se estiren todas a la de la más alta)

## Alternativa con `position: absolute`

Si no querés usar `calc()`, otra opción robusta:

```css
.card {
  position: relative;
  max-height: 950px;
  overflow: hidden;
}

.card-header {
  /* height normal */
}

.card-body {
  position: absolute;
  top: 55px;      /* altura del header */
  bottom: 0;
  left: 0;
  right: 0;
  overflow-y: auto;
}
```

Funciona igual, pero tenés que hardcodear el `top` al tamaño del header.

## Resumen visual

```
┌─────────────────────────┐  ← max-height: 950px
│     CARD HEADER         │  ← flex-shrink: 0 (~55px)
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ row 1               │ │
│ │ row 2               │ │  ← max-height: calc(950-55)
│ │ row 3               │ │     overflow-y: auto
│ │ row 4               │ │     min-height: 0
│ │ ...                 │ │
│ │ row N               │ │
│ └─────────────────────┘ │  ← scrollbar aparece acá
└─────────────────────────┘  ← overflow: hidden (recorta)
```