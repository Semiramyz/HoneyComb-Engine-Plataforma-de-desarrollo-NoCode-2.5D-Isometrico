cmake_minimum_required(VERSION 3.20)
project(honeycomb_engine CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(SDL2 CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

# raylib se compila desde el codigo fuente (no via vcpkg) para usar el backend
# de ventanas SDL2 en vez de GLFW: en esta maquina, GLFW se cuelga al crear
# la ventana OpenGL (bug de interaccion GLFW + driver NVIDIA, confirmado con
# depurador: el hilo principal queda bloqueado dentro de nvoglv64.dll).
set(PLATFORM "SDL" CACHE STRING "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
    raylib
    GIT_REPOSITORY https://github.com/raysan5/raylib.git
    GIT_TAG 6.0
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(raylib)

add_executable(engine main.cpp)
target_link_libraries(engine PRIVATE raylib SDL2::SDL2 nlohmann_json::nlohmann_json)

if(TARGET SDL2::SDL2)
    add_custom_command(TARGET engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:SDL2::SDL2>" "$<TARGET_FILE_DIR:engine>"
    )
endif()
