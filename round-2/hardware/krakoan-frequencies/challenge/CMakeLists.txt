cmake_minimum_required(VERSION 3.16)

set(IDF_TARGET "esp32c3" CACHE STRING "")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(krakoa-gateway)
