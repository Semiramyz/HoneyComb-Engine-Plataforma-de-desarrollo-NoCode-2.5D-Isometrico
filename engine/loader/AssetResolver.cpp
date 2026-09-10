// Implementacion de AssetResolver. El contrato esta documentado en el .hpp.
//
// Trabaja con strings y no con std::filesystem::path a proposito: las rutas del
// JSON siempre usan "/" como separador, y armarlas a mano garantiza que un
// mismo nivel se lea igual en Windows y en Linux.

#include "AssetResolver.hpp"

#include <fstream>

AssetResolver::AssetResolver(std::string assetsRoot) : assetsRoot_(std::move(assetsRoot)) {}

std::string AssetResolver::Resolve(const std::string& relativePath) const {
    return assetsRoot_ + "/" + relativePath;
}

// Se comprueba abriendo el archivo, y no con filesystem::exists, porque lo que
// importa aca es si se va a poder LEER: un archivo que existe pero no se puede
// abrir (permisos, ruta ocupada) tiene que contar como ausente.
bool AssetResolver::Exists(const std::string& relativePath) const {
    std::ifstream file(Resolve(relativePath));
    return file.good();
}
