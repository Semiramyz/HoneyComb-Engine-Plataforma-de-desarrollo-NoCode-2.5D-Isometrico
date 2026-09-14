// Implementacion de CombatView. El contrato esta documentado en el .hpp.

#include "CombatView.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

namespace CombatView {

namespace {

constexpr int kCircleSegments = 32;

Color WithAlpha(Color color, float alpha) {
    color.a = static_cast<unsigned char>(std::clamp(alpha, 0.0f, 1.0f) * 255.0f);
    return color;
}

Color EffectColor(const Combat::Effect& effect) {
    if (effect.faction == Combat::Faction::Enemy) {
        return Color{235, 80, 80, 255};
    }
    return effect.ability ? Color{110, 215, 255, 255} : Color{255, 214, 110, 255};
}

// raylib descarta los triangulos segun el sentido en que vienen los vertices,
// y despues de proyectar a isometrico ese sentido depende de la forma. Se
// manda en los dos: exactamente uno sobrevive, sin tener que calcular cual.
void FillTriangle(Vector2 a, Vector2 b, Vector2 c, Color color) {
    DrawTriangle(a, b, c, color);
    DrawTriangle(a, c, b, color);
}

// Un abanico desde "center" por los puntos de "ring" (todos en celdas).
void DrawFan(Vector2 center, const std::vector<Vector2>& ring, bool closed, const ToScreen& toScreen,
             Color fill, Color outline) {
    const Vector2 centerScreen = toScreen(center);
    std::vector<Vector2> points;
    points.reserve(ring.size());
    for (const auto& point : ring) {
        points.push_back(toScreen(point));
    }
    const std::size_t count = points.size();
    const std::size_t edges = closed ? count : count - 1;
    for (std::size_t index = 0; index < edges; ++index) {
        const Vector2 from = points[index];
        const Vector2 to = points[(index + 1) % count];
        FillTriangle(centerScreen, from, to, fill);
        DrawLineEx(from, to, 2.0f, outline);
    }
    if (!closed && count > 0) {
        DrawLineEx(centerScreen, points.front(), 2.0f, outline);
        DrawLineEx(centerScreen, points.back(), 2.0f, outline);
    }
}

std::vector<Vector2> CircleRing(Vector2 center, float radius) {
    std::vector<Vector2> ring;
    for (int index = 0; index < kCircleSegments; ++index) {
        const float angle = 2.0f * PI * index / kCircleSegments;
        ring.push_back(Vector2{center.x + std::cos(angle) * radius, center.y + std::sin(angle) * radius});
    }
    return ring;
}

void DrawEffect(const Combat::Effect& effect, const ToScreen& toScreen) {
    const Color base = EffectColor(effect);
    const float life = effect.duration > 0.0f ? effect.remaining / effect.duration : 0.0f;

    if (effect.telegraph) {
        // Aviso de un area que va a caer: el borde late y el relleno crece a
        // medida que se acerca el impacto, para poder salir a tiempo.
        const float progress = 1.0f - life;
        const float pulse = 0.55f + 0.45f * std::sin(effect.remaining * 18.0f);
        DrawFan(effect.origin, CircleRing(effect.origin, effect.length * std::max(0.15f, progress)), true,
                toScreen, WithAlpha(base, 0.18f), WithAlpha(base, 0.0f));
        DrawFan(effect.origin, CircleRing(effect.origin, effect.length), true, toScreen, WithAlpha(base, 0.06f),
                WithAlpha(base, pulse));
        return;
    }

    const Color fill = WithAlpha(base, 0.35f * life);
    const Color outline = WithAlpha(base, 0.9f * life);
    switch (effect.shape) {
    case Combat::EffectShape::Circle:
        DrawFan(effect.origin, CircleRing(effect.origin, effect.length), true, toScreen, fill, outline);
        break;
    case Combat::EffectShape::Cone: {
        if (effect.angle >= 360.0f) {
            DrawFan(effect.origin, CircleRing(effect.origin, effect.length), true, toScreen, fill, outline);
            break;
        }
        const float facing = std::atan2(effect.direction.y, effect.direction.x);
        const float half = effect.angle * DEG2RAD / 2.0f;
        const int segments = std::max(4, static_cast<int>(effect.angle / 360.0f * kCircleSegments));
        std::vector<Vector2> arc;
        for (int index = 0; index <= segments; ++index) {
            const float angle = facing - half + (2.0f * half) * index / segments;
            arc.push_back(Vector2{effect.origin.x + std::cos(angle) * effect.length,
                                  effect.origin.y + std::sin(angle) * effect.length});
        }
        DrawFan(effect.origin, arc, false, toScreen, fill, outline);
        break;
    }
    case Combat::EffectShape::Line: {
        const Vector2 side{-effect.direction.y * effect.width / 2.0f, effect.direction.x * effect.width / 2.0f};
        const Vector2 end{effect.origin.x + effect.direction.x * effect.length,
                          effect.origin.y + effect.direction.y * effect.length};
        const std::vector<Vector2> corners{
            Vector2{effect.origin.x + side.x, effect.origin.y + side.y},
            Vector2{end.x + side.x, end.y + side.y},
            Vector2{end.x - side.x, end.y - side.y},
            Vector2{effect.origin.x - side.x, effect.origin.y - side.y},
        };
        const Vector2 middle{(effect.origin.x + end.x) / 2.0f, (effect.origin.y + end.y) / 2.0f};
        DrawFan(middle, corners, true, toScreen, fill, outline);
        break;
    }
    }
}

void DrawCenteredText(GraphicsDevice& gfx, const Font& font, const std::string& text, float centerX, float y,
                      float size, Color color) {
    const Vector2 measured = MeasureTextEx(font, text.c_str(), size, 1.0f);
    gfx.DrawText(font, text.c_str(), Vector2{centerX - measured.x / 2.0f, y}, size, color);
}

// Texto centrado sobre una franja oscura: se lee igual sobre un fondo claro
// que sobre uno oscuro, que el HUD no conoce.
void DrawTag(GraphicsDevice& gfx, const Font& font, const std::string& text, float centerX, float y, float size,
             Color color) {
    const Vector2 measured = MeasureTextEx(font, text.c_str(), size, 1.0f);
    DrawRectangle(static_cast<int>(centerX - measured.x / 2.0f - 8.0f), static_cast<int>(y - 3.0f),
                  static_cast<int>(measured.x + 16.0f), static_cast<int>(measured.y + 6.0f), Color{0, 0, 0, 150});
    DrawCenteredText(gfx, font, text, centerX, y, size, color);
}

// El sprite de un objeto metido en un cuadrado de "box" pixeles, sin deformarlo.
void DrawItemIcon(GraphicsDevice& gfx, const ItemDef& item, Rectangle box) {
    if (!item.texture || item.sourceRect.width <= 0.0f || item.sourceRect.height <= 0.0f) {
        return;
    }
    const float zoom = std::min(box.width / item.sourceRect.width, box.height / item.sourceRect.height);
    const float width = item.sourceRect.width * zoom;
    const float height = item.sourceRect.height * zoom;
    gfx.DrawSprite(*item.texture, item.sourceRect,
                   Rectangle{box.x + (box.width - width) / 2.0f, box.y + (box.height - height) / 2.0f, width, height},
                   Vector2{0, 0}, 0.0f, WHITE);
}

}  // namespace

void SubmitGroundItems(ZSortSystem& zsort, const Loot::State& loot, const ToScreen& toScreen, float time) {
    for (const auto& ground : loot.ground) {
        if (!ground.item.texture) {
            continue;
        }
        const Vector2 sortPosition = toScreen(ground.position);
        const float width = ground.item.sourceRect.width * ground.item.scale;
        const float height = ground.item.sourceRect.height * ground.item.scale;
        // Flota un poco: se distingue de un sprite del decorado de un vistazo.
        const float bob = std::sin(time * 3.0f + ground.position.x) * 2.0f;
        zsort.Submit(SpriteInstance{
            ground.item.texture,
            ground.item.sourceRect,
            Vector2{sortPosition.x - width / 2.0f, sortPosition.y - height - 2.0f + bob},
            sortPosition,
            Vector2{0, 0},
            0.0f,
            ground.waitForExit ? Color{255, 255, 255, 170} : WHITE,
            SpriteLayer::Entity,
            Vector2{width, height}});
    }
}

void DrawEffects(const Combat::State& state, const ToScreen& toScreen) {
    for (const auto& effect : state.effects) {
        DrawEffect(effect, toScreen);
    }
}

void DrawProjectiles(const Combat::State& state, const ToScreen& toScreen) {
    // Los proyectiles van "en el aire": un punto sobre su sombra en el piso.
    constexpr float kHeight = 14.0f;
    for (const auto& projectile : state.projectiles) {
        const Vector2 ground = toScreen(projectile.position);
        const Vector2 edge = toScreen(Vector2{projectile.position.x + projectile.attack.width / 2.0f,
                                              projectile.position.y});
        const float radius = std::max(3.0f, std::hypot(edge.x - ground.x, edge.y - ground.y));
        const bool explosive = projectile.attack.pattern == AttackPattern::Explosive;
        Color color = projectile.faction == Combat::Faction::Enemy ? Color{240, 90, 90, 255}
                      : projectile.ability                          ? Color{120, 220, 255, 255}
                                                                    : Color{255, 230, 140, 255};
        if (explosive) {
            color = Color{255, 150, 60, 255};
        }
        const Vector2 tail = toScreen(Vector2{projectile.position.x - projectile.direction.x * 0.6f,
                                              projectile.position.y - projectile.direction.y * 0.6f});
        DrawEllipse(static_cast<int>(ground.x), static_cast<int>(ground.y), radius, radius / 2.0f,
                    Color{0, 0, 0, 70});
        DrawLineEx(Vector2{tail.x, tail.y - kHeight}, Vector2{ground.x, ground.y - kHeight}, radius,
                   WithAlpha(color, 0.35f));
        DrawCircleV(Vector2{ground.x, ground.y - kHeight}, radius * (explosive ? 1.4f : 1.0f), color);
    }
}

void DrawHud(GraphicsDevice& gfx, const Font& font, const Hud& hud) {
    const float width = static_cast<float>(gfx.GetScreenWidth());
    const float height = static_cast<float>(gfx.GetScreenHeight());

    // --- Monedas, esquive y defensa (debajo de la vida) ---
    if (hud.player && hud.inventory) {
        DrawCircle(18, 46, 7.0f, Color{240, 196, 64, 255});
        DrawCircleLines(18, 46, 7.0f, Color{150, 110, 20, 255});
        gfx.DrawText(font, std::to_string(hud.inventory->coins).c_str(), {32, 37}, 20, Color{240, 196, 64, 255});

        float x = 110.0f;
        if (hud.player->dash.enabled && hud.mobility) {
            const float total = hud.player->dash.cooldown + hud.player->dash.duration;
            const float ready = total > 0.0f ? 1.0f - hud.mobility->dashCooldown / total : 1.0f;
            gfx.DrawText(font, "Esquive", {x, 38}, 16, hud.text);
            DrawRectangle(static_cast<int>(x + 62), 42, 60, 8, Color{30, 30, 30, 200});
            DrawRectangle(static_cast<int>(x + 62), 42, static_cast<int>(60 * std::clamp(ready, 0.0f, 1.0f)), 8,
                          ready >= 1.0f ? Color{120, 200, 255, 255} : Color{90, 120, 150, 255});
            x += 136.0f;
        }
        if (hud.mobility && hud.mobility->defending) {
            gfx.DrawText(font, "Defendiendo", {x, 38}, 16, Color{160, 200, 255, 255});
        }
    }

    // --- Jefe: barra grande arriba al centro ---
    // Debajo de la fila de vida y monedas: en una ventana angosta, a la altura
    // de la vida se pisaban.
    if (hud.boss) {
        constexpr float kTop = 62.0f;
        const float barWidth = std::min(420.0f, width - 40.0f);
        const float x = (width - barWidth) / 2.0f;
        DrawTag(gfx, font, hud.boss->id, width / 2.0f, kTop, 18.0f, Color{255, 214, 102, 255});
        DrawRectangle(static_cast<int>(x), static_cast<int>(kTop + 24.0f), static_cast<int>(barWidth), 12,
                      Color{30, 30, 30, 220});
        DrawRectangle(static_cast<int>(x), static_cast<int>(kTop + 24.0f),
                      static_cast<int>(barWidth * std::clamp(hud.boss->health / hud.boss->maxHealth, 0.0f, 1.0f)), 12,
                      Color{200, 50, 60, 255});
        DrawRectangleLines(static_cast<int>(x), static_cast<int>(kTop + 24.0f), static_cast<int>(barWidth), 12,
                           Color{255, 214, 102, 200});
    }

    // --- Inventario: casilleros abajo al centro ---
    constexpr float kSlot = 46.0f;
    constexpr float kGap = 6.0f;
    float slotsTop = height - 34.0f - kSlot;
    if (hud.inventory) {
        const int slots = hud.inventory->Slots();
        const float total = slots * kSlot + (slots - 1) * kGap;
        float x = (width - total) / 2.0f;
        const auto& weapons = hud.inventory->Weapons();
        for (int index = 0; index < slots; ++index, x += kSlot + kGap) {
            const bool active = index == hud.inventory->ActiveIndex();
            const Rectangle box{x, slotsTop, kSlot, kSlot};
            DrawRectangleRec(box, Color{20, 20, 24, 190});
            DrawRectangleLinesEx(box, active ? 2.0f : 1.0f,
                                 active ? Color{255, 214, 102, 255} : Color{110, 110, 110, 200});
            gfx.DrawText(font, std::to_string(index + 1).c_str(), {x + 3, slotsTop + 2}, 12, LIGHTGRAY);
            if (index >= static_cast<int>(weapons.size())) {
                continue;
            }
            const InventorySlot& slot = weapons[index];
            DrawItemIcon(gfx, slot.item, Rectangle{x + 7, slotsTop + 7, kSlot - 14, kSlot - 14});

            // Contador de la habilidad: una marca por golpe, llena al estar lista.
            if (slot.item.weapon.hasAbility) {
                const AbilityDef& ability = slot.item.weapon.ability;
                const bool ready = slot.combo.hits >= ability.hitsRequired;
                const int pips = std::min(ability.hitsRequired, 10);
                const float pipWidth = (kSlot - 4.0f) / pips;
                for (int pip = 0; pip < pips; ++pip) {
                    const bool lit = ready || pip < slot.combo.hits * pips / ability.hitsRequired;
                    DrawRectangle(static_cast<int>(x + 2 + pip * pipWidth), static_cast<int>(slotsTop + kSlot + 2),
                                  static_cast<int>(pipWidth - 1), 4,
                                  lit ? (ready ? Color{110, 215, 255, 255} : Color{255, 214, 110, 255})
                                      : Color{60, 60, 60, 220});
                }
                if (ready) {
                    DrawRectangleLinesEx(Rectangle{x - 2, slotsTop - 2, kSlot + 4, kSlot + 4}, 2.0f,
                                         Color{110, 215, 255, 255});
                }
            }
        }

        if (const InventorySlot* active = hud.inventory->ActiveSlot()) {
            std::string label = active->item.name;
            if (active->item.weapon.hasAbility) {
                const AbilityDef& ability = active->item.weapon.ability;
                if (active->combo.hits >= ability.hitsRequired) {
                    label += "  -  " + ability.name + " lista" + (ability.manual ? " (Q)" : " (atacar)");
                } else {
                    label += "  -  " + ability.name + " " + std::to_string(active->combo.hits) + "/" +
                             std::to_string(ability.hitsRequired);
                }
            }
            DrawTag(gfx, font, label, width / 2.0f, slotsTop - 22.0f, 16.0f, RAYWHITE);
        } else {
            DrawTag(gfx, font, "Sin arma: golpe con las manos", width / 2.0f, slotsTop - 22.0f, 16.0f, LIGHTGRAY);
        }
        slotsTop -= 22.0f;
    }

    // --- Aviso y mensaje ---
    if (!hud.prompt.empty()) {
        DrawTag(gfx, font, hud.prompt, width / 2.0f, slotsTop - 28.0f, 18.0f, Color{255, 230, 160, 255});
    }
    if (!hud.message.empty() && hud.messageAlpha > 0.0f) {
        const float size = 24.0f;
        const Vector2 measured = MeasureTextEx(font, hud.message.c_str(), size, 1.0f);
        const float y = height * 0.28f;
        DrawRectangle(static_cast<int>(width / 2.0f - measured.x / 2.0f - 14.0f), static_cast<int>(y - 8.0f),
                      static_cast<int>(measured.x + 28.0f), static_cast<int>(measured.y + 16.0f),
                      WithAlpha(Color{0, 0, 0, 255}, 0.6f * hud.messageAlpha));
        DrawCenteredText(gfx, font, hud.message, width / 2.0f, y, size, WithAlpha(RAYWHITE, hud.messageAlpha));
    }
}

void DrawShop(GraphicsDevice& gfx, const Font& font, const LoadedLevel& level, const LevelEntity& npc,
              const Inventory& inventory, const std::string& feedback) {
    const float width = static_cast<float>(gfx.GetScreenWidth());
    const float height = static_cast<float>(gfx.GetScreenHeight());
    const float panelWidth = std::min(460.0f, width - 40.0f);
    const float panelHeight = 120.0f + static_cast<float>(npc.shop.size()) * 34.0f;
    const Rectangle panel{(width - panelWidth) / 2.0f, (height - panelHeight) / 2.0f, panelWidth, panelHeight};

    DrawRectangle(0, 0, static_cast<int>(width), static_cast<int>(height), Color{0, 0, 0, 140});
    DrawRectangleRec(panel, Color{28, 28, 34, 240});
    DrawRectangleLinesEx(panel, 2.0f, Color{255, 214, 102, 220});
    DrawCenteredText(gfx, font, "Tienda - " + npc.id, width / 2.0f, panel.y + 12.0f, 22.0f, Color{255, 214, 102, 255});
    DrawCenteredText(gfx, font, "Monedas: " + std::to_string(inventory.coins), width / 2.0f, panel.y + 40.0f, 18.0f,
                     Color{240, 196, 64, 255});

    float y = panel.y + 70.0f;
    for (std::size_t index = 0; index < npc.shop.size(); ++index, y += 34.0f) {
        const ShopEntry& entry = npc.shop[index];
        auto it = level.items.find(entry.item);
        const std::string name = it != level.items.end() ? it->second.name : entry.item;
        const bool affordable = inventory.coins >= entry.price;
        const Color color = affordable ? RAYWHITE : GRAY;
        if (it != level.items.end()) {
            DrawItemIcon(gfx, it->second, Rectangle{panel.x + 44.0f, y - 2.0f, 28.0f, 28.0f});
        }
        gfx.DrawText(font, std::to_string(index + 1).c_str(), {panel.x + 18.0f, y + 2.0f}, 20.0f,
                     Color{255, 214, 102, 255});
        gfx.DrawText(font, name.c_str(), {panel.x + 82.0f, y + 2.0f}, 20.0f, color);
        const std::string price = std::to_string(entry.price) + " monedas";
        const Vector2 measured = MeasureTextEx(font, price.c_str(), 18.0f, 1.0f);
        gfx.DrawText(font, price.c_str(), {panel.x + panelWidth - 18.0f - measured.x, y + 3.0f}, 18.0f,
                     affordable ? Color{240, 196, 64, 255} : GRAY);
    }

    if (!feedback.empty()) {
        DrawCenteredText(gfx, font, feedback, width / 2.0f, panel.y + panelHeight - 50.0f, 18.0f,
                         Color{160, 220, 160, 255});
    }
    DrawCenteredText(gfx, font, "1-9 comprar  |  E cerrar", width / 2.0f, panel.y + panelHeight - 26.0f, 16.0f,
                     LIGHTGRAY);
}

}  // namespace CombatView
